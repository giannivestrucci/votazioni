/**
 * Dati dimostrativi (vedi src/demo.ts).
 * Uso: DATA_DIR=data npm run seed, poi npm start con DEV_OTP=1.
 */
import { join, resolve } from 'node:path';
import { buildApp } from './app.ts';
import { popolaDemo } from './demo.ts';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const { registry, elezioni, app } = await buildApp({
  service: 'all', registryDb: join(dataDir, 'registro.db'), urnaDb: join(dataDir, 'urna.db'),
  urnaToken: 'seed', devOtp: false, secureCookie: false,
});
await popolaDemo(registry!, elezioni!);
console.log('Elezione dimostrativa aperta: accedi come lucia.ferrari@famiglia.it (genitore in 1A e 2B).');
console.log('Dati dimostrativi creati. Accedi come dirigente@scuola.edu.it (o marco.bianchi@scuola.edu.it, ecc.).');
await app.close();
