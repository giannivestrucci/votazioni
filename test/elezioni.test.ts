import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { votaSegreto, type Trasporto } from '../web/src/votoSegreto.ts';
import { proclama, preferenzeIniziali } from '../src/registry/elezioni.ts';
import { sha256hex } from '../src/shared/crypto.ts';

type App = Awaited<ReturnType<typeof buildApp>>;

async function login(a: App, email: string) {
  const { codiceSviluppo } = (await a.app.inject({ method: 'POST', url: '/api/auth/codice', payload: { email } })).json();
  const r = await a.app.inject({ method: 'POST', url: '/api/auth/accedi', payload: { email, codice: codiceSviluppo } });
  return `sid=${r.cookies.find((c) => c.name === 'sid')!.value}`;
}

function client(a: App, cookie: string) {
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await a.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie } });
    const body = r.headers['content-type']?.toString().includes('json') ? r.json() : r.rawPayload;
    if (r.statusCode >= 400) throw Object.assign(new Error(body.messaggio), { status: r.statusCode });
    return body;
  };
  const trasporto: Trasporto = {
    registro: (p, b) => call('POST', '/api' + p, b),
    urna: async (p, b) => {
      const r = await a.app.inject({ method: b ? 'POST' : 'GET', url: '/urna' + p, payload: b as any });
      if (r.statusCode >= 400) throw Object.assign(new Error(r.json().messaggio), { status: r.statusCode });
      return r.json();
    },
  };
  return { get: (u: string) => call('GET', '/api' + u), post: (u: string, p: unknown = {}) => call('POST', '/api' + u, p), trasporto };
}

describe('regole O.M. 215/1991', () => {
  it('preferenze: metà dei posti, almeno una (art. 22 c.7)', () => {
    expect(preferenzeIniziali(1)).toBe(1);
    expect(preferenzeIniziali(2)).toBe(1);
    expect(preferenzeIniziali(4)).toBe(2);
  });
  it('parità sull\'ultimo posto: sorteggio (art. 22 c.8)', () => {
    const v = [{ id: 'a', etichetta: 'A', voti: 5 }, { id: 'b', etichetta: 'B', voti: 3 }, { id: 'c', etichetta: 'C', voti: 3 }, { id: 'd', etichetta: 'D', voti: 0 }];
    const r = proclama(v, 2, () => 1);
    expect(r.eletti.map((e) => e.etichetta)).toEqual(['A', 'C']);
    expect(r.eletti[1].perSorteggio).toBe(true);
    expect(r.sorteggio).toEqual({ tra: ['B', 'C'], posti: 1, estratti: ['C'] });
  });
  it('nessun sorteggio quando i pari coprono esattamente i posti; chi ha zero voti non è eletto', () => {
    const v = [{ id: 'a', etichetta: 'A', voti: 2 }, { id: 'b', etichetta: 'B', voti: 2 }, { id: 'c', etichetta: 'C', voti: 0 }];
    expect(proclama(v, 2).sorteggio).toBeNull();
    expect(proclama(v, 4).eletti).toHaveLength(2);
  });
});

describe('elezione dei rappresentanti dei genitori', () => {
  it('flusso completo: elettorato per classe, voto segreto, scrutinio, verbale', async () => {
    const a = await buildApp({ service: 'all', registryDb: ':memory:', urnaDb: ':memory:', urnaToken: 't', devOtp: true, secureCookie: false, mail: { send: async () => {} } });
    a.registry!.creaUtente(null, { email: 'ds@scuola.it', nome: 'D', cognome: 'S', ruolo: 'admin' });
    const ds = client(a, await login(a, 'ds@scuola.it'));
    const ora = Date.now();
    const { id } = await ds.post('/elezioni', {
      titolo: 'Rappresentanti dei genitori 2026/27', componente: 'genitori',
      apertura: new Date(ora - 60_000).toISOString(), chiusura: new Date(ora + 3600_000).toISOString(),
    });
    const csv = [
      'classe;email;nome;cognome',
      '1A;anna@x.it;Anna;Rossi', '1A;bruno@x.it;Bruno;Verdi', '1A;carla@x.it;Carla;Neri',
      '1A;carla@x.it;Carla;Neri', // secondo figlio nella stessa classe: un solo voto
      '2B;anna@x.it;Anna;Rossi', '2B;dario@x.it;Dario;Bianchi',
      '2B;email-sbagliata;X;Y',
    ].join('\n');
    const imp = await ds.post(`/elezioni/${id}/importa`, { csv, posti: 1 });
    expect(imp.aggiunti).toBe(5);
    expect(imp.errori).toHaveLength(1);

    await ds.post(`/elezioni/${id}/apri`);
    // dopo l'apertura l'elettorato non si modifica
    await expect(ds.post(`/elezioni/${id}/importa`, { csv: '1A;z@x.it;Z;Z', posti: 1 })).rejects.toMatchObject({ status: 409 });

    const anna = client(a, await login(a, 'anna@x.it'));
    const schede = await anna.get('/mie-schede');
    expect(schede.map((s: any) => s.classe).sort()).toEqual(['1A', '2B']);
    const s1A = schede.find((s: any) => s.classe === '1A');
    expect(s1A.candidati).toEqual(['Neri Carla', 'Rossi Anna', 'Verdi Bruno']);

    const vota = (c: ReturnType<typeof client>, classeId: string, scelte: string[]) => votaSegreto(c.trasporto, classeId, scelte, `/elezioni/classi/${classeId}/gettone`);
    const s2B = schede.find((s: any) => s.classe === '2B');
    const ric = await vota(anna, s1A.classeId, ['Verdi Bruno']);
    await vota(anna, s2B.classeId, ['Bianchi Dario']);
    await expect(vota(anna, s1A.classeId, ['Rossi Anna'])).rejects.toMatchObject({ status: 409 });
    // più preferenze del consentito: rifiutate dall'Urna
    const bruno = client(a, await login(a, 'bruno@x.it'));
    await expect(vota(bruno, s1A.classeId, ['Verdi Bruno', 'Rossi Anna'])).rejects.toMatchObject({ status: 400 });
    await vota(bruno, s1A.classeId, ['Verdi Bruno']); // il gettone non era stato consumato
    // dario non è elettore della 1A
    const dario = client(a, await login(a, 'dario@x.it'));
    await expect(vota(dario, s1A.classeId, ['Verdi Bruno'])).rejects.toMatchObject({ status: 403 });
    const carla = client(a, await login(a, 'carla@x.it'));
    await vota(carla, s1A.classeId, []); // scheda bianca

    await ds.post(`/elezioni/${id}/chiudi`);
    const d = await ds.get(`/elezioni/${id}`);
    const c1A = d.classi.find((c: any) => c.classe === '1A');
    expect(c1A.elettori).toBe(3);
    expect(c1A.esito.votanti).toBe(3);
    expect(c1A.esito.bianche).toBe(1);
    expect(c1A.esito.eletti.map((e: any) => e.etichetta)).toEqual(['Verdi Bruno']);
    const bacheca = (await a.app.inject({ url: `/urna/urne/${s1A.classeId}/bacheca` })).json();
    expect(bacheca.receipts).toContain(ric);

    expect((await anna.get('/mie-schede')).find((s: any) => s.classe === '1A').eletti).toEqual(['Verdi Bruno']);

    const pdf = await ds.get(`/elezioni/${id}/verbale.pdf`);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    const ver = (await a.app.inject({ method: 'POST', url: '/api/pubblico/verifica', payload: { sha256: sha256hex(new Uint8Array(pdf)) } })).json();
    expect(ver).toMatchObject({ trovato: true, firmaValida: true });
  });

  it('fuori dalla finestra oraria il seggio è chiuso', async () => {
    const a = await buildApp({ service: 'all', registryDb: ':memory:', urnaDb: ':memory:', urnaToken: 't', devOtp: true, secureCookie: false, mail: { send: async () => {} } });
    a.registry!.creaUtente(null, { email: 'ds@scuola.it', nome: 'D', cognome: 'S', ruolo: 'admin' });
    const ds = client(a, await login(a, 'ds@scuola.it'));
    const domani = Date.now() + 24 * 3600_000;
    const { id } = await ds.post('/elezioni', { titolo: 'X', componente: 'studenti', apertura: new Date(domani).toISOString(), chiusura: new Date(domani + 3600_000).toISOString() });
    await ds.post(`/elezioni/${id}/importa`, { csv: '3C;s1@x.it;S;Uno\n3C;s2@x.it;S;Due', posti: 2 });
    await ds.post(`/elezioni/${id}/apri`);
    const s = client(a, await login(a, 's1@x.it'));
    const [sch] = await s.get('/mie-schede');
    expect(sch.preferenze).toBe(1);
    await expect(votaSegreto(s.trasporto, sch.classeId, ['Due S'], `/elezioni/classi/${sch.classeId}/gettone`)).rejects.toMatchObject({ status: 409 });
  });
});
