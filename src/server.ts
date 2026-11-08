import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.ts';
import { emailSenderDaEnv } from './registry/auth.ts';

const env = process.env;
const service = (env.SERVICE ?? 'all') as 'all' | 'registry' | 'urna';
const dataDir = resolve(env.DATA_DIR ?? 'data');
const prod = env.NODE_ENV === 'production';

if (service === 'registry' && !env.URNA_URL) throw new Error('URNA_URL obbligatorio con SERVICE=registry');
if (service !== 'all' && !env.URNA_TOKEN) throw new Error('URNA_TOKEN obbligatorio quando Registro e Urna sono separati');
if (prod && env.DEV_OTP === '1') throw new Error('DEV_OTP non è ammesso in produzione');

const { app, registry } = await buildApp({
  service,
  registryDb: join(dataDir, 'registro.db'),
  urnaDb: join(dataDir, 'urna.db'),
  urnaUrl: env.URNA_URL,
  urnaToken: env.URNA_TOKEN ?? 'sviluppo-' + Math.random().toString(36).slice(2),
  devOtp: env.DEV_OTP === '1',
  secureCookie: prod,
  mail: service === 'urna' ? undefined : emailSenderDaEnv(env),
});

// Primo amministratore (dirigente o segreteria), se indicato.
if (registry && env.ADMIN_EMAIL) {
  try {
    registry.creaUtente(null, { email: env.ADMIN_EMAIL, nome: env.ADMIN_NOME ?? 'Dirigente', cognome: env.ADMIN_COGNOME ?? 'Scolastico', ruolo: 'admin' });
    console.log(`Creato amministratore ${env.ADMIN_EMAIL}`);
  } catch { /* già presente */ }
}

const webDist = resolve('web/dist');
if (service !== 'urna' && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/urna')) return reply.code(404).send({ errore: 'nonTrovato' });
    return reply.sendFile('index.html');
  });
}

const port = Number(env.PORT ?? 3000);
await app.listen({ port, host: env.HOST ?? '0.0.0.0' });
console.log(`Votazioni (${service}) in ascolto su http://localhost:${port}`);
