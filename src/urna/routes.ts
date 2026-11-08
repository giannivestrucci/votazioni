import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { UrnaError, UrnaService } from './service.ts';

/**
 * API dell'Urna. Le rotte /internal sono riservate al Registro (header x-urna-token).
 * Le rotte pubbliche non richiedono autenticazione: la legittimazione al voto è il gettone firmato.
 */
export function urnaRoutes(app: FastifyInstance, svc: UrnaService, internalToken: string) {
  const internal = (req: any) => {
    const got = Buffer.from(String(req.headers['x-urna-token'] ?? ''));
    const exp = Buffer.from(internalToken);
    if (got.length !== exp.length || !timingSafeEqual(got, exp)) throw new UrnaError('auth', 'Non autorizzato', 401);
  };

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof UrnaError) return reply.code(err.status).send({ errore: err.code, messaggio: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ errore: 'validazione', messaggio: 'Dati non validi' });
    // Nessun dettaglio della richiesta nei log dell'Urna.
    return reply.code(500).send({ errore: 'interno', messaggio: 'Errore interno' });
  });

  app.post('/internal/urne', async (req) => {
    internal(req);
    const b = z.object({ motionId: z.string(), publicKey: z.string(), options: z.array(z.string()).min(1), maxChoices: z.number().int().min(1).default(1) }).parse(req.body);
    svc.apri(b.motionId, b.publicKey, b.options, b.maxChoices);
    return { ok: true };
  });

  app.post('/internal/urne/:id/chiudi', async (req) => {
    internal(req);
    const { tokensIssued } = z.object({ tokensIssued: z.number().int().min(0) }).parse(req.body);
    return svc.chiudi((req.params as any).id, tokensIssued);
  });

  app.get('/internal/urne/:id/conteggio', async (req) => {
    internal(req);
    return { schede: svc.conteggio((req.params as any).id) };
  });

  app.get('/urne/:id', async (req) => svc.info((req.params as any).id));

  app.post('/urne/:id/schede', async (req) => {
    const b = z.object({ msg: z.string().max(2048), sig: z.string().max(2048), choice: z.array(z.string()).max(50) }).parse(req.body);
    return svc.deposita((req.params as any).id, b.msg, b.sig, b.choice);
  });

  app.get('/urne/:id/bacheca', async (req, reply) => {
    const r = svc.risultato((req.params as any).id);
    if (!r) return reply.code(409).send({ errore: 'aperta', messaggio: 'Bacheca disponibile a votazione chiusa' });
    return r;
  });
}

/** Client usato dal Registro per parlare con l'Urna. */
export interface UrnaClient {
  apri(motionId: string, publicKey: string, options: string[], maxChoices: number): Promise<void>;
  chiudi(motionId: string, tokensIssued: number): Promise<{ tally: { counts: Record<string, number>; schede: number; bianche: number }; root: string; receipts: string[]; anomaly: string | null }>;
  conteggio(motionId: string): Promise<number>;
}

/** Stesso processo (sviluppo, test): chiamata diretta, database comunque separato. */
export class DirectUrnaClient implements UrnaClient {
  constructor(private svc: UrnaService) {}
  async apri(m: string, pk: string, o: string[], mc: number) { this.svc.apri(m, pk, o, mc); }
  async chiudi(m: string, t: number) { return this.svc.chiudi(m, t); }
  async conteggio(m: string) { return this.svc.conteggio(m); }
}

/** Produzione: Urna in un processo/host separato. */
export class HttpUrnaClient implements UrnaClient {
  constructor(private baseUrl: string, private token: string) {}
  private async call(path: string, method: string, body?: unknown) {
    const r = await fetch(this.baseUrl + path, {
      method, headers: { 'content-type': 'application/json', 'x-urna-token': this.token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Urna: ${j.messaggio ?? r.status}`);
    return j;
  }
  async apri(motionId: string, publicKey: string, options: string[], maxChoices: number) { await this.call('/internal/urne', 'POST', { motionId, publicKey, options, maxChoices }); }
  async chiudi(motionId: string, tokensIssued: number) { return this.call(`/internal/urne/${motionId}/chiudi`, 'POST', { tokensIssued }); }
  async conteggio(motionId: string) { return (await this.call(`/internal/urne/${motionId}/conteggio`, 'GET')).schede; }
}
