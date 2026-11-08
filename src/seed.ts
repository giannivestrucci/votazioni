/**
 * Dati dimostrativi: un dirigente (admin) e un collegio dei docenti con 8 componenti.
 * Uso: DATA_DIR=data npm run seed, poi npm start con DEV_OTP=1.
 */
import { join, resolve } from 'node:path';
import { buildApp } from './app.ts';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const { registry, elezioni, app } = await buildApp({
  service: 'all', registryDb: join(dataDir, 'registro.db'), urnaDb: join(dataDir, 'urna.db'),
  urnaToken: 'seed', devOtp: false, secureCookie: false,
});
const r = registry!;
let admin;
try { r.creaUtente(null, { email: 'dirigente@scuola.edu.it', nome: 'Daniela', cognome: 'Dirigente', ruolo: 'admin' }); } catch { /* esiste */ }
admin = r['db'].prepare('SELECT id, email, nome, cognome, ruolo FROM utenti WHERE email = ?').get('dirigente@scuola.edu.it') as any;

const organoId = r.creaOrgano(admin, 'Collegio dei docenti', 'collegio_docenti');
const nomi = [['Marco', 'Bianchi'], ['Giulia', 'Romano'], ['Luca', 'Colombo'], ['Sara', 'Ricci'], ['Paolo', 'Marino'], ['Elena', 'Greco'], ['Andrea', 'Bruno'], ['Chiara', 'Gallo']];
const csv = nomi.map(([n, c]) => `${n.toLowerCase()}.${c.toLowerCase()}@scuola.edu.it;${n};${c}`).join('\n');
r.importaComponenti(admin, organoId, `dirigente@scuola.edu.it;Daniela;Dirigente\n${csv}`);
const comp = r.componenti(organoId);
const pres = comp.find((c) => c.email === 'dirigente@scuola.edu.it')!;
const segr = comp.find((c) => c.email === 'giulia.romano@scuola.edu.it')!;
const domani = new Date(Date.now() + 24 * 3600_000); domani.setHours(16, 30, 0, 0);
r.creaSeduta(admin, {
  organoId, titolo: 'Collegio dei docenti ordinario', odg: 'Approvazione del verbale della seduta precedente\nAggiornamento del PTOF\nDesignazione del docente tutor neoassunti',
  dataOra: domani.toISOString(), modalita: 'mista', presidenteId: pres.id, segretarioId: segr.id,
});
const el = elezioni!;
const eid = el.crea(admin, { titolo: 'Rappresentanti dei genitori 2026/27', componente: 'genitori', apertura: new Date(Date.now() - 3600_000).toISOString(), chiusura: new Date(Date.now() + 2 * 24 * 3600_000).toISOString() });
const genitori = [['1A', 'Lucia', 'Ferrari'], ['1A', 'Matteo', 'Esposito'], ['1A', 'Francesca', 'Russo'], ['1A', 'Giorgio', 'Conti'], ['2B', 'Laura', 'Costa'], ['2B', 'Stefano', 'Fontana'], ['2B', 'Lucia', 'Ferrari']];
el.importa(admin, eid, genitori.map(([k, n, c]) => `${k};${n.toLowerCase()}.${c.toLowerCase()}@famiglia.it;${n};${c}`).join('\n'), 1);
await el.apri(admin, eid);
console.log('Elezione dimostrativa aperta: accedi come lucia.ferrari@famiglia.it (genitore in 1A e 2B).');
console.log('Dati dimostrativi creati. Accedi come dirigente@scuola.edu.it (o marco.bianchi@scuola.edu.it, ecc.).');
await app.close();
