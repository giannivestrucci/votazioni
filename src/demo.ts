/**
 * Dati dimostrativi: un dirigente (admin), un collegio dei docenti con 8 componenti e una seduta,
 * un'elezione dei rappresentanti dei genitori già aperta (classi 1A e 2B).
 */
import type { RegistryService } from './registry/service.ts';
import type { ElezioniService } from './registry/elezioni.ts';

export const ACCOUNT_DEMO = {
  dirigente: 'dirigente@scuola.edu.it',
  docente: 'marco.bianchi@scuola.edu.it',
  genitore: 'lucia.ferrari@famiglia.it',
};

export async function popolaDemo(r: RegistryService, el: ElezioniService) {
  try { r.creaUtente(null, { email: ACCOUNT_DEMO.dirigente, nome: 'Daniela', cognome: 'Dirigente', ruolo: 'admin' }); } catch { /* esiste */ }
  const admin = r['db'].prepare('SELECT id, email, nome, cognome, ruolo FROM utenti WHERE email = ?').get(ACCOUNT_DEMO.dirigente) as any;

  const organoId = r.creaOrgano(admin, 'Collegio dei docenti', 'collegio_docenti');
  const nomi = [['Marco', 'Bianchi'], ['Giulia', 'Romano'], ['Luca', 'Colombo'], ['Sara', 'Ricci'], ['Paolo', 'Marino'], ['Elena', 'Greco'], ['Andrea', 'Bruno'], ['Chiara', 'Gallo']];
  const csv = nomi.map(([n, c]) => `${n.toLowerCase()}.${c.toLowerCase()}@scuola.edu.it;${n};${c}`).join('\n');
  r.importaComponenti(admin, organoId, `${ACCOUNT_DEMO.dirigente};Daniela;Dirigente\n${csv}`);
  const comp = r.componenti(organoId);
  const pres = comp.find((c) => c.email === ACCOUNT_DEMO.dirigente)!;
  const segr = comp.find((c) => c.email === 'giulia.romano@scuola.edu.it')!;
  const domani = new Date(Date.now() + 24 * 3600_000); domani.setHours(16, 30, 0, 0);
  r.creaSeduta(admin, {
    organoId, titolo: 'Collegio dei docenti ordinario', odg: 'Approvazione del verbale della seduta precedente\nAggiornamento del PTOF\nDesignazione del docente tutor neoassunti',
    dataOra: domani.toISOString(), modalita: 'mista', presidenteId: pres.id, segretarioId: segr.id,
  });

  const eid = el.crea(admin, { titolo: 'Rappresentanti dei genitori 2026/27', componente: 'genitori', apertura: new Date(Date.now() - 3600_000).toISOString(), chiusura: new Date(Date.now() + 2 * 24 * 3600_000).toISOString() });
  const genitori = [['1A', 'Lucia', 'Ferrari'], ['1A', 'Matteo', 'Esposito'], ['1A', 'Francesca', 'Russo'], ['1A', 'Giorgio', 'Conti'], ['2B', 'Laura', 'Costa'], ['2B', 'Stefano', 'Fontana'], ['2B', 'Lucia', 'Ferrari']];
  el.importa(admin, eid, genitori.map(([k, n, c]) => `${k};${n.toLowerCase()}.${c.toLowerCase()}@famiglia.it;${n};${c}`).join('\n'), 1);
  await el.apri(admin, eid);
}

/** Vero se il database non contiene ancora organi collegiali (prima accensione). */
export function databaseVuoto(r: RegistryService) {
  return !(r['db'].prepare('SELECT 1 FROM organi LIMIT 1').get());
}
