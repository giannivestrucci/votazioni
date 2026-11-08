import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { openDb } from './shared/db.ts';
import { generateSigningKey, randomToken } from './shared/crypto.ts';
import { UrnaService, URNA_SCHEMA } from './urna/service.ts';
import { DirectUrnaClient, HttpUrnaClient, urnaRoutes, type UrnaClient } from './urna/routes.ts';
import { REGISTRY_SCHEMA } from './registry/schema.ts';
import { RegistryService } from './registry/service.ts';
import { AuthService, ConsoleEmailSender, DEFAULT_AUTH, type AuthConfig, type EmailSender } from './registry/auth.ts';
import { registryRoutes } from './registry/routes.ts';

export interface AppOptions {
  /** 'all' = Registro e Urna nello stesso processo (sviluppo, piccole installazioni); in produzione separarli. */
  service: 'all' | 'registry' | 'urna';
  registryDb: string;
  urnaDb: string;
  urnaUrl?: string;
  urnaToken: string;
  devOtp: boolean;
  secureCookie: boolean;
  mail?: EmailSender;
  authConfig?: AuthConfig;
  logger?: boolean;
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export async function buildApp(o: AppOptions) {
  // Il logger HTTP resta spento per l'Urna: non deve conservare IP né orari delle richieste di voto.
  const app = Fastify({ logger: o.service === 'registry' ? (o.logger ?? true) : false, trustProxy: true, bodyLimit: 1_000_000 });
  app.addHook('onSend', async (_req, reply) => { for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v); });

  let urnaSvc: UrnaService | undefined;
  if (o.service !== 'registry') {
    urnaSvc = new UrnaService(openDb(o.urnaDb, URNA_SCHEMA));
    await app.register(async (sub: FastifyInstance) => urnaRoutes(sub, urnaSvc!, o.urnaToken), { prefix: '/urna' });
  }

  let registry: RegistryService | undefined;
  let auth: AuthService | undefined;
  if (o.service !== 'urna') {
    const db = openDb(o.registryDb, REGISTRY_SCHEMA);
    const client: UrnaClient = urnaSvc ? new DirectUrnaClient(urnaSvc) : new HttpUrnaClient(o.urnaUrl!, o.urnaToken);
    registry = new RegistryService(db, client);
    auth = new AuthService(db, registry.audit, o.mail ?? new ConsoleEmailSender(), o.authConfig ?? DEFAULT_AUTH);
    let firma = registry.impostazione('firma_ed25519');
    if (!firma) { firma = JSON.stringify(generateSigningKey()); registry.setImpostazione('firma_ed25519', firma); }
    await app.register(cookie);
    const reg = registry; const au = auth; const f = JSON.parse(firma);
    await app.register(async (sub: FastifyInstance) => registryRoutes(sub, { auth: au, svc: reg, firma: f, devOtp: o.devOtp, secureCookie: o.secureCookie }), { prefix: '/api' });
  }

  app.get('/salute', async () => ({ ok: true, servizio: o.service }));
  return { app, registry, auth, urna: urnaSvc };
}

export const defaultUrnaToken = () => process.env.URNA_TOKEN ?? randomToken();
