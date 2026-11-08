import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.ts';
import { votaSegreto, type Trasporto } from '../web/src/votoSegreto.ts';
import { calcolaEsitoDelibera, quorumStrutturale } from '../src/registry/service.ts';
import { sha256hex } from '../src/shared/crypto.ts';

type App = Awaited<ReturnType<typeof buildApp>>;

async function nuovaApp() {
  return buildApp({ service: 'all', registryDb: ':memory:', urnaDb: ':memory:', urnaToken: 't', devOtp: true, secureCookie: false, mail: { send: async () => {} } });
}

async function login(a: App, email: string) {
  const r1 = await a.app.inject({ method: 'POST', url: '/api/auth/codice', payload: { email } });
  const { codiceSviluppo } = r1.json();
  const r2 = await a.app.inject({ method: 'POST', url: '/api/auth/accedi', payload: { email, codice: codiceSviluppo } });
  expect(r2.statusCode).toBe(200);
  const c = r2.cookies.find((x) => x.name === 'sid')!;
  expect(c.path).toBe('/api');
  expect(c.httpOnly).toBe(true);
  return `sid=${c.value}`;
}

function client(a: App, cookie: string) {
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await a.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie } });
    const body = r.headers['content-type']?.toString().includes('json') ? r.json() : r.rawPayload;
    if (r.statusCode >= 400) throw Object.assign(new Error(body.messaggio), { status: r.statusCode, body });
    return body;
  };
  return {
    get: (u: string) => call('GET', '/api' + u),
    post: (u: string, p: unknown = {}) => call('POST', '/api' + u, p),
    trasporto: {
      registro: (p: string, b: unknown) => call('POST', '/api' + p, b),
      // L'Urna viene chiamata SENZA cookie, come fa il browser (cookie con Path=/api).
      urna: async (p: string, b?: unknown) => {
        const r = await a.app.inject({ method: b ? 'POST' : 'GET', url: '/urna' + p, payload: b as any });
        if (r.statusCode >= 400) throw Object.assign(new Error(r.json().messaggio), { status: r.statusCode });
        return r.json();
      },
    } satisfies Trasporto,
  };
}

async function scenario(n = 5) {
  const a = await nuovaApp();
  a.registry!.creaUtente(null, { email: 'ds@scuola.it', nome: 'Dora', cognome: 'Dirigente', ruolo: 'admin' });
  const ds = client(a, await login(a, 'ds@scuola.it'));
  const { id: organoId } = await ds.post('/organi', { nome: 'Collegio dei docenti', tipo: 'collegio_docenti' });
  const csv = ['email;nome;cognome', ...Array.from({ length: n }, (_, i) => `doc${i}@scuola.it;Doc${i};Cognome${i}`)].join('\n');
  const imp = await ds.post(`/organi/${organoId}/importa`, { csv });
  expect(imp.aggiunti).toBe(n);
  const comp = await ds.get(`/organi/${organoId}/componenti`);
  const pres = comp.find((c: any) => c.email === 'doc0@scuola.it');
  const segr = comp.find((c: any) => c.email === 'doc1@scuola.it');
  const { id: sedutaId } = await ds.post('/sedute', {
    organoId, titolo: 'Collegio di novembre', odg: 'Approvazione verbale\nPTOF', dataOra: '2026-11-20T15:00:00.000Z',
    modalita: 'mista', presidenteId: pres.id, segretarioId: segr.id,
  });
  const docenti = [] as ReturnType<typeof client>[];
  for (let i = 0; i < n; i++) docenti.push(client(a, await login(a, `doc${i}@scuola.it`)));
  return { a, ds, sedutaId, docenti, presidente: docenti[0] };
}

describe('regole di delibera (art. 37 D.Lgs. 297/1994)', () => {
  it('numero legale: metà più uno', () => {
    expect(quorumStrutturale(10)).toBe(6);
    expect(quorumStrutturale(11)).toBe(6);
  });
  it('maggioranza assoluta dei voti validi, astenuti esclusi per default', () => {
    expect(calcolaEsitoDelibera({ Favorevole: 5, Contrario: 4, Astenuto: 10 }, { tipo: 'palese', astenutiComputati: false }).risultato).toBe('approvata');
    expect(calcolaEsitoDelibera({ Favorevole: 5, Contrario: 4, Astenuto: 10 }, { tipo: 'palese', astenutiComputati: true }).risultato).toBe('respinta');
  });
  it('parità: prevale il presidente nel palese, respinta nel segreto', () => {
    const c = { Favorevole: 4, Contrario: 4, Astenuto: 0 };
    expect(calcolaEsitoDelibera(c, { tipo: 'palese', astenutiComputati: false, votoPresidente: 'Favorevole' }).risultato).toBe('approvata');
    expect(calcolaEsitoDelibera(c, { tipo: 'palese', astenutiComputati: false, votoPresidente: 'Contrario' }).risultato).toBe('respinta');
    expect(calcolaEsitoDelibera(c, { tipo: 'segreta', astenutiComputati: false }).risultato).toBe('respinta');
  });
});

describe('autenticazione', () => {
  it('non rivela se una email è registrata e blocca dopo troppi tentativi', async () => {
    const a = await nuovaApp();
    a.registry!.creaUtente(null, { email: 'x@scuola.it', nome: 'X', cognome: 'Y' });
    const ignoto = await a.app.inject({ method: 'POST', url: '/api/auth/codice', payload: { email: 'nessuno@scuola.it' } });
    expect(ignoto.json()).toEqual({ ok: true });
    const r = await a.app.inject({ method: 'POST', url: '/api/auth/codice', payload: { email: 'x@scuola.it' } });
    const giusto = r.json().codiceSviluppo;
    const sbagliato = giusto === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const k = await a.app.inject({ method: 'POST', url: '/api/auth/accedi', payload: { email: 'x@scuola.it', codice: sbagliato } });
      expect(k.statusCode).toBe(401);
    }
    const k = await a.app.inject({ method: 'POST', url: '/api/auth/accedi', payload: { email: 'x@scuola.it', codice: giusto } });
    expect(k.statusCode).toBe(401);
  });

  it('un nuovo accesso chiude la sessione precedente', async () => {
    const a = await nuovaApp();
    a.registry!.creaUtente(null, { email: 'x@scuola.it', nome: 'X', cognome: 'Y' });
    const c1 = await login(a, 'x@scuola.it');
    const c2 = await login(a, 'x@scuola.it');
    expect((await a.app.inject({ url: '/api/me', headers: { cookie: c1 } })).statusCode).toBe(401);
    expect((await a.app.inject({ url: '/api/me', headers: { cookie: c2 } })).statusCode).toBe(200);
  });
});

describe('seduta collegiale', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  beforeEach(async () => { s = await scenario(5); });

  it('non apre una votazione deliberativa senza numero legale', async () => {
    await s.presidente.post(`/sedute/${s.sedutaId}/apri`);
    await s.docenti[0].post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata', modalita: 'remoto' });
    await s.docenti[1].post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata', modalita: 'presenza' });
    const { id } = await s.presidente.post(`/sedute/${s.sedutaId}/votazioni`, { oggetto: 'PTOF', tipo: 'palese' });
    await expect(s.presidente.post(`/votazioni/${id}/apri`)).rejects.toMatchObject({ status: 409 });
  });

  it('voto palese: un voto per avente diritto, immodificabile, esito e nominativi', async () => {
    await s.presidente.post(`/sedute/${s.sedutaId}/apri`);
    for (const d of s.docenti.slice(0, 4)) await d.post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata', modalita: 'remoto' });
    const { id } = await s.presidente.post(`/sedute/${s.sedutaId}/votazioni`, { oggetto: 'Approvazione PTOF', tipo: 'palese' });
    await s.presidente.post(`/votazioni/${id}/apri`);
    await s.docenti[0].post(`/votazioni/${id}/voto`, { scelte: ['Favorevole'] });
    await s.docenti[1].post(`/votazioni/${id}/voto`, { scelte: ['Favorevole'] });
    await s.docenti[2].post(`/votazioni/${id}/voto`, { scelte: ['Contrario'] });
    await expect(s.docenti[2].post(`/votazioni/${id}/voto`, { scelte: ['Favorevole'] })).rejects.toMatchObject({ status: 409 });
    // il docente 4 non era presente all'apertura: non può votare
    await expect(s.docenti[4].post(`/votazioni/${id}/voto`, { scelte: ['Favorevole'] })).rejects.toMatchObject({ status: 403 });
    const esito = await s.presidente.post(`/votazioni/${id}/chiudi`);
    expect(esito.counts).toEqual({ Favorevole: 2, Contrario: 1, Astenuto: 0 });
    expect(esito.risultato).toBe('approvata');
    const vista = await s.docenti[3].get(`/sedute/${s.sedutaId}`);
    expect(vista.votazioni[0].votiPalesi).toHaveLength(3);
  });

  it('voto segreto: anonimo, un solo voto, conteggio corretto, bacheca verificabile', async () => {
    await s.presidente.post(`/sedute/${s.sedutaId}/apri`);
    for (const d of s.docenti) await d.post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata', modalita: 'remoto' });
    const { id } = await s.presidente.post(`/sedute/${s.sedutaId}/votazioni`, { oggetto: 'Designazione tutor', tipo: 'segreta' });
    await s.presidente.post(`/votazioni/${id}/apri`);

    const scelte = ['Favorevole', 'Favorevole', 'Contrario', 'Favorevole'];
    const ricevute: string[] = [];
    for (const [i, sc] of scelte.entries()) ricevute.push(await votaSegreto(s.docenti[i].trasporto, id, [sc]));

    // secondo voto dello stesso docente: rifiutato al ritiro del gettone
    await expect(votaSegreto(s.docenti[0].trasporto, id, ['Contrario'])).rejects.toMatchObject({ status: 409 });
    // scheda con firma contraffatta: rifiutata dall'Urna
    const falso = await s.a.app.inject({ method: 'POST', url: `/urna/urne/${id}/schede`, payload: { msg: 'AAAA', sig: 'AAAA', choice: ['Contrario'] } });
    expect(falso.statusCode).toBe(403);
    // durante il voto l'Urna non rivela l'esito
    expect((await s.a.app.inject({ url: `/urna/urne/${id}/bacheca` })).statusCode).toBe(409);

    const esito = await s.presidente.post(`/votazioni/${id}/chiudi`);
    expect(esito.counts).toEqual({ Favorevole: 3, Contrario: 1, Astenuto: 0 });
    expect(esito.risultato).toBe('approvata');
    expect(esito.anomalia).toBeNull();

    const bacheca = (await s.a.app.inject({ url: `/urna/urne/${id}/bacheca` })).json();
    for (const r of ricevute) expect(bacheca.receipts).toContain(r);
    expect(sha256hex([...bacheca.receipts].sort().join('\n'))).toBe(bacheca.root);

    // separazione strutturale: il Registro non contiene le scelte, l'Urna non contiene identità
    const reg = s.a.registry!['db'];
    const tabelleReg = JSON.stringify(reg.prepare('SELECT * FROM gettoni').all());
    expect(tabelleReg).not.toMatch(/Favorevole|Contrario/);
    const urnaDump = JSON.stringify(s.a.urna!['db'].prepare('SELECT * FROM schede').all());
    for (let i = 0; i < 5; i++) expect(urnaDump).not.toContain(`doc${i}@`);
    // la chiave privata di firma è distrutta alla chiusura
    expect(reg.prepare('SELECT chiave_priv FROM votazioni WHERE id = ?').get(id)).toEqual({ chiave_priv: null });
  });

  it('annullamento per malfunzionamento e ripetizione', async () => {
    await s.presidente.post(`/sedute/${s.sedutaId}/apri`);
    for (const d of s.docenti) await d.post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata' });
    const { id } = await s.presidente.post(`/sedute/${s.sedutaId}/votazioni`, { oggetto: 'Uscita didattica', tipo: 'segreta' });
    await s.presidente.post(`/votazioni/${id}/apri`);
    await votaSegreto(s.docenti[1].trasporto, id, ['Favorevole']);
    const { nuovaId } = await s.presidente.post(`/votazioni/${id}/annulla`, { motivo: 'Interruzione della connessione per 3 componenti', ripeti: true });
    expect(nuovaId).toBeTruthy();
    await s.presidente.post(`/votazioni/${nuovaId}/apri`);
    // nella ripetizione si vota di nuovo
    await votaSegreto(s.docenti[1].trasporto, nuovaId, ['Contrario']);
    const esito = await s.presidente.post(`/votazioni/${nuovaId}/chiudi`);
    expect(esito.counts.Contrario).toBe(1);
  });

  it('verbale PDF firmato, immodificabile dopo la chiusura, verificabile', async () => {
    await s.presidente.post(`/sedute/${s.sedutaId}/apri`);
    for (const d of s.docenti) await d.post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'entrata', modalita: 'remoto' });
    const { id } = await s.presidente.post(`/sedute/${s.sedutaId}/votazioni`, { oggetto: 'Approvazione verbale seduta precedente', tipo: 'palese' });
    await s.presidente.post(`/votazioni/${id}/apri`);
    for (const d of s.docenti) await d.post(`/votazioni/${id}/voto`, { scelte: ['Favorevole'] });
    await s.presidente.post(`/votazioni/${id}/chiudi`);
    await s.docenti[3].post(`/sedute/${s.sedutaId}/presenze`, { tipo: 'uscita' });
    await s.presidente.post(`/sedute/${s.sedutaId}/chiudi`);

    // un semplice componente non può scaricare il verbale
    await expect(s.docenti[3].get(`/sedute/${s.sedutaId}/verbale.pdf`)).rejects.toMatchObject({ status: 403 });

    const pdf = await s.presidente.get(`/sedute/${s.sedutaId}/verbale.pdf`);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    const pdf2 = await s.presidente.get(`/sedute/${s.sedutaId}/verbale.pdf`);
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(pdf2))).toBe(0);

    const ver = (await s.a.app.inject({ method: 'POST', url: '/api/pubblico/verifica', payload: { sha256: sha256hex(new Uint8Array(pdf)) } })).json();
    expect(ver).toMatchObject({ trovato: true, firmaValida: true });

    const audit = await s.presidente.get(`/sedute/${s.sedutaId}/audit`);
    expect(audit.integrita.ok).toBe(true);
  });

  it('il registro di audit rileva manomissioni', async () => {
    const db = s.a.registry!['db'];
    expect(s.a.registry!.audit.verify().ok).toBe(true);
    expect(() => db.prepare("UPDATE audit SET action = 'x' WHERE seq = 1").run()).toThrow(/append-only/);
  });
});
