import { randomInt, randomUUID } from 'node:crypto';
import type { DB } from '../shared/db.ts';
import { tx } from '../shared/db.ts';
import type { AuditLog } from '../shared/audit.ts';
import { b64u, blindSuite, generateBlindKeyPair, importBlindPrivate } from '../shared/crypto.ts';
import type { UrnaClient } from '../urna/routes.ts';
import type { Utente } from './auth.ts';
import { RegistryError } from './service.ts';

/**
 * Elezione dei rappresentanti di genitori o studenti nei consigli di classe,
 * interclasse e intersezione con la procedura semplificata (O.M. 215/1991, artt. 21-22).
 * Ogni classe è un'urna distinta. Come prevede l'art. 22 c.7, si vota su "una unica lista
 * comprendente tutti gli elettori in ordine alfabetico": ogni elettore è anche eleggibile.
 */

export interface Candidato { id: string; etichetta: string }
export interface EsitoClasse {
  votanti: number;
  bianche: number;
  voti: { id: string; etichetta: string; voti: number }[];
  eletti: { id: string; etichetta: string; voti: number; perSorteggio: boolean }[];
  sorteggio: null | { tra: string[]; posti: number; estratti: string[] };
  anomalia: string | null;
}

/** Art. 22 c.7: "ciascun elettore può votare la metà dei membri da eleggere se gli eligendi sono in numero superiore a uno". */
export const preferenzeIniziali = (posti: number) => Math.max(1, Math.floor(posti / 2));

/**
 * Proclamazione: i candidati più votati fino a coprire i posti; a parità di voti
 * sull'ultimo posto disponibile si procede per sorteggio (art. 22 c.8), registrato nel verbale.
 * Un candidato senza voti non viene eletto.
 */
export function proclama(voti: { id: string; etichetta: string; voti: number }[], posti: number, rnd: (n: number) => number = randomInt) {
  const ordinati = voti.filter((v) => v.voti > 0).sort((a, b) => b.voti - a.voti || a.etichetta.localeCompare(b.etichetta, 'it'));
  if (ordinati.length <= posti) return { eletti: ordinati.map((v) => ({ ...v, perSorteggio: false })), sorteggio: null };
  const soglia = ordinati[posti - 1].voti;
  const sicuri = ordinati.filter((v) => v.voti > soglia);
  const pari = ordinati.filter((v) => v.voti === soglia);
  const liberi = posti - sicuri.length;
  if (pari.length === liberi) return { eletti: [...sicuri, ...pari].map((v) => ({ ...v, perSorteggio: false })), sorteggio: null };
  const urna = [...pari]; const estratti: typeof pari = [];
  while (estratti.length < liberi) estratti.push(urna.splice(rnd(urna.length), 1)[0]);
  return {
    eletti: [...sicuri.map((v) => ({ ...v, perSorteggio: false })), ...estratti.map((v) => ({ ...v, perSorteggio: true }))],
    sorteggio: { tra: pari.map((p) => p.etichetta), posti: liberi, estratti: estratti.map((e) => e.etichetta) },
  };
}

export class ElezioniService {
  constructor(private db: DB, private audit: AuditLog, private urna: UrnaClient, private now: () => Date = () => new Date()) {}
  private ts() { return this.now().toISOString(); }
  private soloAdmin(u: Utente) {
    if (u.ruolo !== 'admin') throw new RegistryError('permesso', 'Operazione riservata alla commissione elettorale o alla segreteria', 403);
  }

  crea(attore: Utente, d: { titolo: string; componente: 'genitori' | 'studenti'; apertura: string; chiusura: string }) {
    this.soloAdmin(attore);
    if (Date.parse(d.chiusura) <= Date.parse(d.apertura)) throw new RegistryError('date', 'La chiusura deve seguire l\'apertura');
    const id = randomUUID();
    this.db.prepare('INSERT INTO elezioni (id, titolo, componente, apertura, chiusura, creata) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, d.titolo.trim(), d.componente, d.apertura, d.chiusura, this.ts());
    this.audit.append('elezione.creata', { id, ...d }, attore.id);
    return id;
  }

  elezione(id: string) {
    const e = this.db.prepare('SELECT * FROM elezioni WHERE id = ?').get(id) as any;
    if (!e) throw new RegistryError('nonTrovata', 'Elezione non trovata', 404);
    return e as { id: string; titolo: string; componente: 'genitori' | 'studenti'; apertura: string; chiusura: string; stato: 'bozza' | 'aperta' | 'chiusa'; aperta_il: string | null; chiusa_il: string | null };
  }

  classe(id: string) {
    const c = this.db.prepare('SELECT * FROM elezione_classi WHERE id = ?').get(id) as any;
    if (!c) throw new RegistryError('nonTrovata', 'Classe non trovata', 404);
    return c as { id: string; elezione_id: string; classe: string; posti: number; preferenze: number; candidati: string | null; chiave_pub: string | null; chiave_priv: string | null; esito: string | null; radice: string | null };
  }

  elenco(attore: Utente) {
    this.soloAdmin(attore);
    return this.db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM elezione_classi c WHERE c.elezione_id = e.id) AS n_classi FROM elezioni e ORDER BY apertura DESC`).all();
  }

  /**
   * Importa l'elettorato da CSV: classe;email;nome;cognome (un genitore o uno studente per riga).
   */
  importa(attore: Utente, elezioneId: string, csv: string, postiDefault: number) {
    this.soloAdmin(attore);
    const e = this.elezione(elezioneId);
    if (e.stato !== 'bozza') throw new RegistryError('stato', 'L\'elettorato si può modificare solo prima dell\'apertura', 409);
    if (!(postiDefault >= 1)) throw new RegistryError('posti', 'Indica i posti da coprire per classe');
    const righe = csv.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const errori: string[] = []; let aggiunti = 0;
    tx(this.db, () => {
      for (const [i, r] of righe.entries()) {
        const [classe, email, nome, cognome] = r.split(/[;\t]/).map((s) => s?.trim());
        if (i === 0 && classe?.toLowerCase() === 'classe') continue;
        if (!classe) { errori.push(`Riga ${i + 1}: classe mancante`); continue; }
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errori.push(`Riga ${i + 1}: email non valida`); continue; }
        let c = this.db.prepare('SELECT id FROM elezione_classi WHERE elezione_id = ? AND classe = ?').get(elezioneId, classe) as { id: string } | undefined;
        if (!c) {
          c = { id: randomUUID() };
          this.db.prepare('INSERT INTO elezione_classi (id, elezione_id, classe, posti, preferenze) VALUES (?, ?, ?, ?, ?)')
            .run(c.id, elezioneId, classe, postiDefault, preferenzeIniziali(postiDefault));
        }
        let u = this.db.prepare('SELECT id FROM utenti WHERE email = ?').get(email) as { id: string } | undefined;
        if (!u) {
          u = { id: randomUUID() };
          this.db.prepare('INSERT INTO utenti (id, email, nome, cognome, ruolo, creato) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, email, nome ?? '', cognome ?? '', 'utente', this.ts());
        }
        // Più figli nella stessa classe: un solo voto per elettore e per classe.
        const ins = this.db.prepare('INSERT OR IGNORE INTO elettori (classe_id, utente_id, candidabile) VALUES (?, ?, 1)').run(c.id, u.id);
        if (ins.changes) aggiunti++;
      }
    });
    this.audit.append('elezione.elettorato_importato', { elezioneId, aggiunti, errori: errori.length }, attore.id);
    return { aggiunti, errori };
  }

  impostaClasse(attore: Utente, classeId: string, posti: number, preferenze: number) {
    this.soloAdmin(attore);
    const c = this.classe(classeId);
    if (this.elezione(c.elezione_id).stato !== 'bozza') throw new RegistryError('stato', 'Elezione già aperta', 409);
    if (posti < 1 || preferenze < 1 || preferenze > posti) throw new RegistryError('valori', 'Posti e preferenze non validi (le preferenze non possono superare i posti)');
    this.db.prepare('UPDATE elezione_classi SET posti = ?, preferenze = ? WHERE id = ?').run(posti, preferenze, classeId);
    this.audit.append('elezione.classe_impostata', { classeId, posti, preferenze }, attore.id);
  }

  private candidatiCorrenti(classeId: string): Candidato[] {
    const rows = this.db.prepare(`SELECT u.id, u.nome, u.cognome FROM elettori el JOIN utenti u ON u.id = el.utente_id
      WHERE el.classe_id = ? AND el.candidabile = 1 ORDER BY u.cognome, u.nome`).all(classeId) as { id: string; nome: string; cognome: string }[];
    const visti = new Map<string, number>();
    return rows.map((r) => {
      const base = `${r.cognome} ${r.nome}`.trim() || 'Senza nome';
      const n = (visti.get(base) ?? 0) + 1; visti.set(base, n);
      return { id: r.id, etichetta: n > 1 ? `${base} (${n})` : base };
    });
  }

  async apri(attore: Utente, elezioneId: string) {
    this.soloAdmin(attore);
    const e = this.elezione(elezioneId);
    if (e.stato !== 'bozza') throw new RegistryError('stato', 'Elezione già aperta o chiusa', 409);
    const classi = this.db.prepare('SELECT id, classe FROM elezione_classi WHERE elezione_id = ?').all(elezioneId) as { id: string; classe: string }[];
    if (!classi.length) throw new RegistryError('vuota', 'Importa prima l\'elettorato');
    for (const c of classi) {
      const candidati = this.candidatiCorrenti(c.id);
      if (!candidati.length) throw new RegistryError('candidati', `Nessun candidato nella classe ${c.classe}`);
      const cl = this.classe(c.id);
      const k = await generateBlindKeyPair();
      await this.urna.apri(c.id, k.publicKeySpki, candidati.map((x) => x.etichetta), Math.min(cl.preferenze, candidati.length));
      this.db.prepare('UPDATE elezione_classi SET candidati = ?, chiave_pub = ?, chiave_priv = ? WHERE id = ?')
        .run(JSON.stringify(candidati), k.publicKeySpki, k.privateKeyPkcs8, c.id);
    }
    this.db.prepare(`UPDATE elezioni SET stato = 'aperta', aperta_il = ? WHERE id = ?`).run(this.ts(), elezioneId);
    this.audit.append('elezione.aperta', { elezioneId, classi: classi.length }, attore.id);
  }

  /** Schede per l'utente: una per ogni classe in cui è elettore. */
  schede(utente: Utente) {
    const rows = this.db.prepare(`SELECT e.id AS elezione_id, e.titolo, e.componente, e.stato, e.apertura, e.chiusura, c.id AS classe_id, c.classe, c.posti, c.preferenze, c.candidati, c.esito,
      EXISTS (SELECT 1 FROM gettoni_elezione g WHERE g.classe_id = c.id AND g.utente_id = ?) AS ho_votato
      FROM elettori el JOIN elezione_classi c ON c.id = el.classe_id JOIN elezioni e ON e.id = c.elezione_id
      WHERE el.utente_id = ? AND e.stato <> 'bozza' ORDER BY e.apertura DESC, c.classe`).all(utente.id, utente.id) as any[];
    return rows.map((r) => {
      const esito = r.esito ? JSON.parse(r.esito) as EsitoClasse : null;
      return {
        elezioneId: r.elezione_id, titolo: r.titolo, componente: r.componente, stato: r.stato, apertura: r.apertura, chiusura: r.chiusura,
        classeId: r.classe_id, classe: r.classe, posti: r.posti, preferenze: r.preferenze, hoVotato: !!r.ho_votato,
        candidati: (JSON.parse(r.candidati ?? '[]') as Candidato[]).map((c) => c.etichetta),
        eletti: esito?.eletti.map((x) => x.etichetta) ?? null,
      };
    });
  }

  private finestraAperta(e: { stato: string; apertura: string; chiusura: string }) {
    const t = this.now().getTime();
    return e.stato === 'aperta' && t >= Date.parse(e.apertura) && t <= Date.parse(e.chiusura);
  }

  async rilasciaGettone(utente: Utente, classeId: string, blindedMsgB64: string) {
    const c = this.classe(classeId);
    const e = this.elezione(c.elezione_id);
    if (!this.finestraAperta(e) || !c.chiave_priv) throw new RegistryError('stato', 'Il seggio non è aperto in questo momento', 409);
    const elettore = this.db.prepare('SELECT 1 FROM elettori WHERE classe_id = ? AND utente_id = ?').get(classeId, utente.id);
    if (!elettore) throw new RegistryError('diritto', 'Non risulti nell\'elenco degli elettori di questa classe', 403);
    if (this.db.prepare('SELECT 1 FROM gettoni_elezione WHERE classe_id = ? AND utente_id = ?').get(classeId, utente.id)) {
      throw new RegistryError('giaVotato', 'Hai già votato per questa classe', 409);
    }
    const blindSig = await blindSuite().blindSign(await importBlindPrivate(c.chiave_priv), b64u.dec(blindedMsgB64));
    try {
      this.db.prepare('INSERT INTO gettoni_elezione (classe_id, utente_id) VALUES (?, ?)').run(classeId, utente.id);
    } catch {
      throw new RegistryError('giaVotato', 'Hai già votato per questa classe', 409);
    }
    this.audit.append('elezione.gettone_rilasciato', { classeId }, utente.id);
    return { blindSig: b64u.enc(blindSig) };
  }

  async dettaglio(attore: Utente, elezioneId: string) {
    this.soloAdmin(attore);
    const e = this.elezione(elezioneId);
    const classi = this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM elettori el WHERE el.classe_id = c.id) AS elettori,
      (SELECT COUNT(*) FROM elettori el WHERE el.classe_id = c.id AND el.candidabile = 1) AS candidabili,
      (SELECT COUNT(*) FROM gettoni_elezione g WHERE g.classe_id = c.id) AS votanti
      FROM elezione_classi c WHERE elezione_id = ? ORDER BY classe`).all(elezioneId) as any[];
    return {
      id: e.id, titolo: e.titolo, componente: e.componente, apertura: e.apertura, chiusura: e.chiusura, stato: e.stato, apertaIl: e.aperta_il, chiusaIl: e.chiusa_il,
      classi: classi.map((c) => ({
        id: c.id, classe: c.classe, posti: c.posti, preferenze: c.preferenze, elettori: c.elettori, candidabili: c.candidabili, votanti: c.votanti,
        esito: c.esito ? JSON.parse(c.esito) as EsitoClasse : null, radice: c.radice,
      })),
    };
  }

  async chiudi(attore: Utente, elezioneId: string) {
    this.soloAdmin(attore);
    const e = this.elezione(elezioneId);
    if (e.stato !== 'aperta') throw new RegistryError('stato', 'L\'elezione non è aperta', 409);
    const classi = this.db.prepare('SELECT id FROM elezione_classi WHERE elezione_id = ?').all(elezioneId) as { id: string }[];
    for (const { id } of classi) {
      const c = this.classe(id);
      const candidati = JSON.parse(c.candidati!) as Candidato[];
      const gettoni = (this.db.prepare('SELECT COUNT(*) AS n FROM gettoni_elezione WHERE classe_id = ?').get(id) as any).n;
      const r = await this.urna.chiudi(id, gettoni);
      const voti = candidati.map((k) => ({ id: k.id, etichetta: k.etichetta, voti: r.tally.counts[k.etichetta] ?? 0 }));
      const p = proclama(voti, c.posti);
      const esito: EsitoClasse = { votanti: r.tally.schede, bianche: r.tally.bianche, voti, eletti: p.eletti, sorteggio: p.sorteggio, anomalia: r.anomaly };
      this.db.prepare('UPDATE elezione_classi SET esito = ?, radice = ?, chiave_priv = NULL WHERE id = ?').run(JSON.stringify(esito), r.root, id);
      if (p.sorteggio) this.audit.append('elezione.sorteggio', { classeId: id, ...p.sorteggio }, 'sistema');
    }
    this.db.prepare(`UPDATE elezioni SET stato = 'chiusa', chiusa_il = ? WHERE id = ?`).run(this.ts(), elezioneId);
    this.audit.append('elezione.chiusa', { elezioneId }, attore.id);
  }

  verbale(elezioneId: string) {
    const r = this.db.prepare('SELECT pdf, sha256, firma FROM verbali_elezione WHERE elezione_id = ?').get(elezioneId) as any;
    return r ? { pdf: new Uint8Array(r.pdf), sha256: r.sha256 as string, firma: r.firma as string } : null;
  }

  salvaVerbale(elezioneId: string, pdf: Uint8Array, sha256: string, firma: string) {
    this.db.prepare('INSERT OR IGNORE INTO verbali_elezione (elezione_id, sha256, firma, generato, pdf) VALUES (?, ?, ?, ?, ?)').run(elezioneId, sha256, firma, this.ts(), pdf);
    this.audit.append('elezione.verbale_generato', { elezioneId, sha256 }, 'sistema');
  }

  verbalePerHash(sha256: string) {
    return this.db.prepare(`SELECT v.sha256, v.firma, v.generato, e.titolo FROM verbali_elezione v JOIN elezioni e ON e.id = v.elezione_id WHERE v.sha256 = ?`).get(sha256) as
      { sha256: string; firma: string; generato: string; titolo: string } | undefined;
  }
}
