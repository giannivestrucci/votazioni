import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type AuthService, type Utente } from './auth.ts';
import { RegistryError, type RegistryService, TIPI_ORGANO } from './service.ts';
import { generaVerbalePdf } from './verbale.ts';
import { sha256hex, signEd25519, verifyEd25519 } from '../shared/crypto.ts';

export const COOKIE = 'sid';

export interface RegistryRouteOpts {
  auth: AuthService;
  svc: RegistryService;
  firma: { publicPem: string; privatePem: string };
  devOtp: boolean;
  secureCookie: boolean;
}

export function registryRoutes(app: FastifyInstance, o: RegistryRouteOpts) {
  const { auth, svc } = o;

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof RegistryError || err instanceof AuthError) return reply.code(err.status).send({ errore: err.code, messaggio: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ errore: 'validazione', messaggio: 'Dati non validi', dettagli: err.issues.map((i) => i.path.join('.') + ': ' + i.message) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ errore: 'richiesta', messaggio: err.message });
    app.log.error(err);
    return reply.code(500).send({ errore: 'interno', messaggio: 'Errore interno' });
  });

  const utente = (req: FastifyRequest): Utente => {
    const u = auth.sessione(req.cookies[COOKIE]);
    if (!u) throw new AuthError('sessione', 'Sessione scaduta: accedi di nuovo');
    return u;
  };
  const id = (req: FastifyRequest) => z.string().uuid().parse((req.params as any).id);

  // ---------- Autenticazione ----------
  app.post('/auth/codice', async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const codice = await auth.richiediCodice(email);
    return { ok: true, ...(o.devOtp && codice ? { codiceSviluppo: codice } : {}) };
  });

  app.post('/auth/accedi', async (req, reply) => {
    const b = z.object({ email: z.string().email(), codice: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const { token } = auth.verificaCodice(b.email, b.codice);
    reply.setCookie(COOKIE, token, { path: '/api', httpOnly: true, sameSite: 'strict', secure: o.secureCookie, maxAge: 8 * 3600 });
    return auth.sessione(token);
  });

  app.post('/auth/esci', async (req, reply) => {
    auth.esci(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/me', async (req) => utente(req));

  // ---------- Anagrafiche ----------
  app.get('/tipi-organo', async () => TIPI_ORGANO);
  app.get('/utenti', async (req) => svc.utenti(utente(req)));
  app.post('/utenti', async (req) => {
    const b = z.object({ email: z.string().email(), nome: z.string().min(1), cognome: z.string().min(1), ruolo: z.enum(['admin', 'utente']).default('utente') }).parse(req.body);
    return { id: svc.creaUtente(utente(req), b) };
  });
  app.get('/organi', async (req) => svc.organi(utente(req)));
  app.post('/organi', async (req) => {
    const b = z.object({ nome: z.string().min(1), tipo: z.enum(Object.keys(TIPI_ORGANO) as [string, ...string[]]) }).parse(req.body);
    return { id: svc.creaOrgano(utente(req), b.nome, b.tipo as any) };
  });
  app.get('/organi/:id/componenti', async (req) => {
    const u = utente(req); svc.soloAdmin(u);
    return svc.componenti(id(req));
  });
  app.post('/organi/:id/importa', async (req) => {
    const { csv } = z.object({ csv: z.string().max(500_000) }).parse(req.body);
    return svc.importaComponenti(utente(req), id(req), csv);
  });
  app.delete('/organi/:id/componenti/:uid', async (req) => {
    svc.rimuoviComponente(utente(req), id(req), z.string().uuid().parse((req.params as any).uid));
    return { ok: true };
  });

  // ---------- Sedute ----------
  app.get('/sedute', async (req) => svc.sedute(utente(req)));
  app.post('/sedute', async (req) => {
    const b = z.object({
      organoId: z.string().uuid(), titolo: z.string().min(1), odg: z.string().default(''), dataOra: z.string().datetime({ offset: true }).or(z.string().datetime()),
      modalita: z.enum(['distanza', 'mista', 'presenza']), presidenteId: z.string().uuid(), segretarioId: z.string().uuid(), astenutiComputati: z.boolean().default(false),
    }).parse(req.body);
    return { id: svc.creaSeduta(utente(req), b) };
  });

  app.get('/sedute/:id', async (req) => {
    const u = utente(req); const sid = id(req);
    if (!svc.puoAccedere(u, sid)) throw new RegistryError('permesso', 'Non fai parte di questo organo', 403);
    const s = svc.seduta(sid);
    const presidenza = u.ruolo === 'admin' || u.id === s.presidente_id || u.id === s.segretario_id;
    const presenti = svc.presenti(sid);
    const votazioni = await Promise.all(svc.votazioni(sid).map(async (v) => ({
      ...v,
      hoVotato: svc.haVotato(u.id, v.id),
      possoVotare: v.stato === 'aperta' && JSON.parse(svc.votazione(v.id).aventi_diritto ?? '[]').includes(u.id),
      affluenza: v.stato === 'aperta' || v.stato === 'chiusa' ? await svc.affluenza(v.id) : null,
      votiPalesi: v.stato === 'chiusa' && v.tipo === 'palese' ? svc.votiPalesi(v.id) : undefined,
    })));
    const componenti = svc.componentiSeduta(sid);
    const nome = (x: string) => { const c = componenti.find((k) => k.id === x); return c ? `${c.nome} ${c.cognome}` : ''; };
    return {
      id: s.id, titolo: s.titolo, odg: s.odg, dataOra: s.data_ora, modalita: s.modalita, stato: s.stato, apertaIl: s.aperta_il, chiusaIl: s.chiusa_il,
      organo: { id: s.organo_id, nome: s.organo_nome, tipo: s.organo_tipo }, astenutiComputati: !!s.astenuti_computati,
      presidente: { id: s.presidente_id, nome: nome(s.presidente_id) }, segretario: { id: s.segretario_id, nome: nome(s.segretario_id) },
      quorum: svc.quorum(sid),
      presenti: presenti.map((p) => ({ id: p.id, nome: p.nome, cognome: p.cognome, modalita: p.modalita })),
      componenti: presidenza ? componenti.map((c) => ({ id: c.id, nome: c.nome, cognome: c.cognome })) : undefined,
      votazioni,
      io: { id: u.id, presidenza, presente: presenti.find((p) => p.id === u.id)?.modalita ?? null },
    };
  });

  app.post('/sedute/:id/apri', async (req) => { svc.apriSeduta(utente(req), id(req)); return { ok: true }; });
  app.post('/sedute/:id/chiudi', async (req) => { svc.chiudiSeduta(utente(req), id(req)); return { ok: true }; });
  app.post('/sedute/:id/presenze', async (req) => {
    const b = z.object({ utenteId: z.string().uuid().optional(), tipo: z.enum(['entrata', 'uscita']), modalita: z.enum(['presenza', 'remoto']).optional() }).parse(req.body);
    svc.registraPresenza(utente(req), id(req), b);
    return { ok: true };
  });
  app.post('/sedute/:id/votazioni', async (req) => {
    const b = z.object({
      oggetto: z.string().min(1).max(500), descrizione: z.string().max(5000).optional(), tipo: z.enum(['palese', 'segreta']),
      opzioni: z.array(z.string().min(1).max(200)).max(50).optional(), maxScelte: z.number().int().min(1).optional(),
    }).parse(req.body);
    return { id: svc.creaVotazione(utente(req), id(req), b) };
  });

  // ---------- Votazioni ----------
  app.post('/votazioni/:id/apri', async (req) => { await svc.apriVotazione(utente(req), id(req)); return { ok: true }; });
  app.post('/votazioni/:id/chiudi', async (req) => svc.chiudiVotazione(utente(req), id(req)));
  app.post('/votazioni/:id/annulla', async (req) => {
    const b = z.object({ motivo: z.string().min(3), ripeti: z.boolean().default(true) }).parse(req.body);
    return { nuovaId: await svc.annullaVotazione(utente(req), id(req), b.motivo, b.ripeti) };
  });
  app.post('/votazioni/:id/voto', async (req) => {
    const { scelte } = z.object({ scelte: z.array(z.string()).min(1) }).parse(req.body);
    svc.votoPalese(utente(req), id(req), scelte);
    return { ok: true };
  });
  app.post('/votazioni/:id/gettone', async (req) => {
    const { blindedMsg } = z.object({ blindedMsg: z.string().max(2048) }).parse(req.body);
    return svc.rilasciaGettone(utente(req), id(req), blindedMsg);
  });

  // ---------- Verbale e audit ----------
  const presidenza = (req: FastifyRequest) => {
    const u = utente(req); const s = svc.seduta(id(req));
    svc.soloPresidenza(u, s);
    return { u, s };
  };

  app.get('/sedute/:id/verbale.pdf', async (req, reply: FastifyReply) => {
    const { s } = presidenza(req);
    let pdf: Uint8Array; let hash: string; let firma: string;
    const salvato = s.stato === 'chiusa' ? svc.verbale(s.id) : null;
    if (salvato) {
      ({ pdf, sha256: hash, firma } = salvato);
    } else {
      pdf = await generaVerbalePdf(svc, s.id);
      hash = sha256hex(pdf);
      firma = signEd25519(o.firma.privatePem, hash);
      // A seduta chiusa il verbale è generato una sola volta e reso immodificabile.
      if (s.stato === 'chiusa') svc.salvaVerbale(s.id, pdf, hash, firma);
    }
    const nomeFile = `verbale-${s.data_ora.slice(0, 10)}-${s.titolo.replace(/[^\w-]+/g, '_').slice(0, 40)}${s.stato === 'chiusa' ? '' : '-PROVVISORIO'}.pdf`;
    reply.header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${nomeFile}"`)
      .header('x-verbale-sha256', hash)
      .header('x-verbale-firma', firma);
    return reply.send(Buffer.from(pdf));
  });

  app.get('/sedute/:id/audit', async (req) => {
    const { s } = presidenza(req);
    return { integrita: svc.audit.verify(), voci: svc.audit.list({ like: s.id }) };
  });

  // ---------- Verifica pubblica ----------
  app.get('/pubblico/chiave', async () => ({ algoritmo: 'Ed25519', chiavePubblica: o.firma.publicPem }));
  app.post('/pubblico/verifica', async (req) => {
    const { sha256 } = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/i) }).parse(req.body);
    const v = svc.verbalePerHash(sha256.toLowerCase());
    if (!v) return { trovato: false };
    return { trovato: true, seduta: v.titolo, organo: v.organo, generato: v.generato, firma: v.firma, firmaValida: verifyEd25519(o.firma.publicPem, v.sha256, v.firma) };
  });
}
