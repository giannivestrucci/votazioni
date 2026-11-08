import { randomUUID } from 'node:crypto';
import type { DB } from '../shared/db.ts';
import { tx } from '../shared/db.ts';
import { AuditLog } from '../shared/audit.ts';
import { b64u, blindSuite, generateBlindKeyPair, importBlindPrivate } from '../shared/crypto.ts';
import type { UrnaClient } from '../urna/routes.ts';
import type { Utente } from './auth.ts';

export class RegistryError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export const OPZIONI_DELIBERA = ['Favorevole', 'Contrario', 'Astenuto'] as const;

export const TIPI_ORGANO = {
  collegio_docenti: 'Collegio dei docenti',
  consiglio_classe: 'Consiglio di classe',
  consiglio_interclasse: 'Consiglio di interclasse',
  consiglio_intersezione: 'Consiglio di intersezione',
  consiglio_istituto: "Consiglio d'istituto",
  glo: 'Gruppo di lavoro operativo (GLO)',
  altro: 'Altro organo',
} as const;
export type TipoOrgano = keyof typeof TIPI_ORGANO;

export interface Esito {
  counts: Record<string, number>;
  votanti: number;
  bianche: number;
  validi: number;
  /** Solo per votazioni deliberative con opzioni Favorevole/Contrario/Astenuto. */
  risultato?: 'approvata' | 'respinta';
  motivazione?: string;
  anomalia?: string | null;
}

/**
 * Esito di una delibera secondo l'art. 37 c.3 D.Lgs. 297/1994:
 * maggioranza assoluta dei voti validamente espressi; in caso di parità prevale
 * il voto del presidente (solo nel voto palese; nel voto segreto la parità respinge).
 * Il computo degli astenuti tra i voti validi è una scelta del regolamento d'istituto.
 */
export function calcolaEsitoDelibera(counts: Record<string, number>, opts: {
  tipo: 'palese' | 'segreta'; astenutiComputati: boolean; votoPresidente?: string | null;
}): Pick<Esito, 'validi' | 'risultato' | 'motivazione'> {
  const fav = counts['Favorevole'] ?? 0;
  const con = counts['Contrario'] ?? 0;
  const ast = counts['Astenuto'] ?? 0;
  const validi = fav + con + (opts.astenutiComputati ? ast : 0);
  if (validi === 0) return { validi, risultato: 'respinta', motivazione: 'Nessun voto valido espresso' };
  if (fav * 2 > validi) return { validi, risultato: 'approvata', motivazione: `Maggioranza assoluta dei voti validi (${fav} su ${validi})` };
  if (opts.tipo === 'palese' && fav === con && !opts.astenutiComputati) {
    if (opts.votoPresidente === 'Favorevole') return { validi, risultato: 'approvata', motivazione: 'Parità: prevale il voto del presidente (art. 37 D.Lgs. 297/1994)' };
    if (opts.votoPresidente === 'Contrario') return { validi, risultato: 'respinta', motivazione: 'Parità: prevale il voto del presidente (art. 37 D.Lgs. 297/1994)' };
  }
  return { validi, risultato: 'respinta', motivazione: `Maggioranza assoluta non raggiunta (${fav} favorevoli su ${validi} voti validi)` };
}

export const quorumStrutturale = (componenti: number) => Math.floor(componenti / 2) + 1;

export class RegistryService {
  readonly audit: AuditLog;
  constructor(private db: DB, private urna: UrnaClient, private now: () => Date = () => new Date()) {
    this.audit = new AuditLog(db, now);
  }
  private ts() { return this.now().toISOString(); }

  // ---------- Utenti e organi ----------

  creaUtente(attore: Utente | null, d: { email: string; nome: string; cognome: string; ruolo?: 'admin' | 'utente' }) {
    if (attore) this.soloAdmin(attore);
    const id = randomUUID();
    try {
      this.db.prepare('INSERT INTO utenti (id, email, nome, cognome, ruolo, creato) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, d.email.trim(), d.nome.trim(), d.cognome.trim(), d.ruolo ?? 'utente', this.ts());
    } catch {
      throw new RegistryError('duplicato', `Esiste già un utente con email ${d.email}`, 409);
    }
    this.audit.append('utente.creato', { id, email: d.email, ruolo: d.ruolo ?? 'utente' }, attore?.id ?? 'sistema');
    return id;
  }

  utenti(attore: Utente) {
    this.soloAdmin(attore);
    return this.db.prepare('SELECT id, email, nome, cognome, ruolo, attivo FROM utenti ORDER BY cognome, nome').all();
  }

  creaOrgano(attore: Utente, nome: string, tipo: TipoOrgano) {
    this.soloAdmin(attore);
    if (!(tipo in TIPI_ORGANO)) throw new RegistryError('tipo', 'Tipo di organo non valido');
    const id = randomUUID();
    this.db.prepare('INSERT INTO organi (id, nome, tipo) VALUES (?, ?, ?)').run(id, nome.trim(), tipo);
    this.audit.append('organo.creato', { id, nome, tipo }, attore.id);
    return id;
  }

  organi(attore: Utente) {
    const rows = attore.ruolo === 'admin'
      ? this.db.prepare('SELECT o.*, (SELECT COUNT(*) FROM componenti c WHERE c.organo_id = o.id) AS n_componenti FROM organi o ORDER BY nome').all()
      : this.db.prepare('SELECT o.*, (SELECT COUNT(*) FROM componenti c WHERE c.organo_id = o.id) AS n_componenti FROM organi o JOIN componenti c ON c.organo_id = o.id WHERE c.utente_id = ? ORDER BY nome').all(attore.id);
    return rows;
  }

  componenti(organoId: string) {
    return this.db.prepare(`SELECT u.id, u.email, u.nome, u.cognome FROM componenti c JOIN utenti u ON u.id = c.utente_id
      WHERE c.organo_id = ? AND u.attivo = 1 ORDER BY u.cognome, u.nome`).all(organoId) as { id: string; email: string; nome: string; cognome: string }[];
  }

  /** Importa componenti da CSV "email;nome;cognome" (o con virgole). Crea gli utenti mancanti. */
  importaComponenti(attore: Utente, organoId: string, csv: string) {
    this.soloAdmin(attore);
    this.organo(organoId);
    const righe = csv.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    let aggiunti = 0; const errori: string[] = [];
    tx(this.db, () => {
      for (const [i, r] of righe.entries()) {
        const [email, nome, cognome] = r.split(/[;,\t]/).map((s) => s?.trim());
        if (i === 0 && email?.toLowerCase() === 'email') continue;
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errori.push(`Riga ${i + 1}: email non valida`); continue; }
        let u = this.db.prepare('SELECT id FROM utenti WHERE email = ?').get(email) as { id: string } | undefined;
        if (!u) {
          const id = randomUUID();
          this.db.prepare('INSERT INTO utenti (id, email, nome, cognome, ruolo, creato) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, email, nome || '', cognome || '', 'utente', this.ts());
          u = { id };
        }
        const r2 = this.db.prepare('INSERT OR IGNORE INTO componenti (organo_id, utente_id) VALUES (?, ?)').run(organoId, u.id);
        if (r2.changes) aggiunti++;
      }
    });
    this.audit.append('organo.componenti_importati', { organoId, aggiunti, errori: errori.length }, attore.id);
    return { aggiunti, errori };
  }

  rimuoviComponente(attore: Utente, organoId: string, utenteId: string) {
    this.soloAdmin(attore);
    this.db.prepare('DELETE FROM componenti WHERE organo_id = ? AND utente_id = ?').run(organoId, utenteId);
    this.audit.append('organo.componente_rimosso', { organoId, utenteId }, attore.id);
  }

  // ---------- Sedute ----------

  creaSeduta(attore: Utente, d: { organoId: string; titolo: string; odg: string; dataOra: string; modalita: 'distanza' | 'mista' | 'presenza'; presidenteId: string; segretarioId: string; astenutiComputati?: boolean }) {
    this.soloAdmin(attore);
    this.organo(d.organoId);
    const ids = new Set(this.componenti(d.organoId).map((c) => c.id));
    if (!ids.has(d.presidenteId)) throw new RegistryError('presidente', 'Il presidente deve essere un componente dell\'organo');
    if (!ids.has(d.segretarioId)) throw new RegistryError('segretario', 'Il segretario deve essere un componente dell\'organo');
    const id = randomUUID();
    this.db.prepare(`INSERT INTO sedute (id, organo_id, titolo, odg, data_ora, modalita, presidente_id, segretario_id, astenuti_computati)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, d.organoId, d.titolo.trim(), d.odg ?? '', d.dataOra, d.modalita, d.presidenteId, d.segretarioId, d.astenutiComputati ? 1 : 0);
    this.audit.append('seduta.creata', { id, ...d }, attore.id);
    return id;
  }

  sedute(attore: Utente) {
    const q = `SELECT s.*, o.nome AS organo_nome, o.tipo AS organo_tipo FROM sedute s JOIN organi o ON o.id = s.organo_id`;
    if (attore.ruolo === 'admin') return this.db.prepare(`${q} ORDER BY s.data_ora DESC`).all();
    return this.db.prepare(`${q} JOIN componenti c ON c.organo_id = s.organo_id AND c.utente_id = ? ORDER BY s.data_ora DESC`).all(attore.id);
  }

  seduta(id: string) {
    const s = this.db.prepare(`SELECT s.*, o.nome AS organo_nome, o.tipo AS organo_tipo FROM sedute s JOIN organi o ON o.id = s.organo_id WHERE s.id = ?`).get(id) as any;
    if (!s) throw new RegistryError('nonTrovata', 'Seduta non trovata', 404);
    return s as {
      id: string; organo_id: string; organo_nome: string; organo_tipo: TipoOrgano; titolo: string; odg: string; data_ora: string;
      modalita: string; presidente_id: string; segretario_id: string; astenuti_computati: number; stato: 'programmata' | 'aperta' | 'chiusa';
      aperta_il: string | null; chiusa_il: string | null; componenti_snapshot: string | null;
    };
  }

  /** Componenti "in carica" della seduta: fotografati all'apertura, così il quorum non cambia se l'organo viene modificato. */
  componentiSeduta(sedutaId: string) {
    const s = this.seduta(sedutaId);
    if (s.componenti_snapshot) return JSON.parse(s.componenti_snapshot) as { id: string; email: string; nome: string; cognome: string }[];
    return this.componenti(s.organo_id);
  }

  puoAccedere(attore: Utente, sedutaId: string) {
    if (attore.ruolo === 'admin') return true;
    return this.componentiSeduta(sedutaId).some((c) => c.id === attore.id);
  }

  apriSeduta(attore: Utente, sedutaId: string) {
    const s = this.seduta(sedutaId);
    this.soloPresidenza(attore, s);
    if (s.stato !== 'programmata') throw new RegistryError('stato', 'La seduta non è in stato programmata', 409);
    const comp = this.componenti(s.organo_id);
    this.db.prepare('UPDATE sedute SET stato = ?, aperta_il = ?, componenti_snapshot = ? WHERE id = ?')
      .run('aperta', this.ts(), JSON.stringify(comp), sedutaId);
    const q = this.quorum(sedutaId);
    this.audit.append('seduta.aperta', { sedutaId, componenti: comp.length, presenti: q.presenti, quorumRichiesto: q.richiesto, quorumOk: q.ok }, attore.id);
  }

  chiudiSeduta(attore: Utente, sedutaId: string) {
    const s = this.seduta(sedutaId);
    this.soloPresidenza(attore, s);
    if (s.stato !== 'aperta') throw new RegistryError('stato', 'La seduta non è aperta', 409);
    const aperte = this.db.prepare(`SELECT COUNT(*) AS n FROM votazioni WHERE seduta_id = ? AND stato = 'aperta'`).get(sedutaId) as { n: number };
    if (aperte.n) throw new RegistryError('votazioniAperte', 'Chiudi prima tutte le votazioni aperte', 409);
    tx(this.db, () => {
      // Registra l'uscita di chi è ancora presente, per completezza del verbale.
      for (const p of this.presenti(sedutaId)) {
        this.db.prepare('INSERT INTO presenze (seduta_id, utente_id, tipo, modalita, ts, registrato_da) VALUES (?, ?, ?, ?, ?, ?)')
          .run(sedutaId, p.id, 'uscita', p.modalita, this.ts(), 'chiusura');
      }
      this.db.prepare('UPDATE sedute SET stato = ?, chiusa_il = ? WHERE id = ?').run('chiusa', this.ts(), sedutaId);
    });
    this.audit.append('seduta.chiusa', { sedutaId }, attore.id);
  }

  // ---------- Presenze e quorum ----------

  registraPresenza(attore: Utente, sedutaId: string, d: { utenteId?: string; tipo: 'entrata' | 'uscita'; modalita?: 'presenza' | 'remoto' }) {
    const s = this.seduta(sedutaId);
    if (s.stato !== 'aperta') throw new RegistryError('stato', 'La seduta non è aperta', 409);
    const target = d.utenteId ?? attore.id;
    if (target !== attore.id) this.soloPresidenza(attore, s);
    if (!this.componentiSeduta(sedutaId).some((c) => c.id === target)) throw new RegistryError('componente', 'Non è un componente dell\'organo', 403);
    const presente = this.presenti(sedutaId).find((p) => p.id === target);
    if (d.tipo === 'entrata' && presente) return;
    if (d.tipo === 'uscita' && !presente) return;
    const modalita = d.tipo === 'entrata' ? (d.modalita ?? (s.modalita === 'presenza' ? 'presenza' : 'remoto')) : presente!.modalita;
    if (s.modalita === 'distanza' && modalita === 'presenza') throw new RegistryError('modalita', 'Seduta interamente a distanza');
    if (s.modalita === 'presenza' && modalita === 'remoto') throw new RegistryError('modalita', 'Seduta in presenza: partecipazione remota non prevista');
    this.db.prepare('INSERT INTO presenze (seduta_id, utente_id, tipo, modalita, ts, registrato_da) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sedutaId, target, d.tipo, modalita, this.ts(), attore.id);
    this.audit.append(`presenza.${d.tipo}`, { sedutaId, utenteId: target, modalita }, attore.id);
  }

  presenti(sedutaId: string) {
    const eventi = this.db.prepare('SELECT utente_id, tipo, modalita FROM presenze WHERE seduta_id = ? ORDER BY id').all(sedutaId) as any[];
    const stato = new Map<string, string | null>();
    for (const e of eventi) stato.set(e.utente_id, e.tipo === 'entrata' ? e.modalita : null);
    const comp = this.componentiSeduta(sedutaId);
    return comp.filter((c) => stato.get(c.id)).map((c) => ({ ...c, modalita: stato.get(c.id) as 'presenza' | 'remoto' }));
  }

  quorum(sedutaId: string) {
    const componenti = this.componentiSeduta(sedutaId).length;
    const presenti = this.presenti(sedutaId).length;
    const richiesto = quorumStrutturale(componenti);
    return { componenti, presenti, richiesto, ok: presenti >= richiesto };
  }

  eventiPresenza(sedutaId: string) {
    return this.db.prepare(`SELECT p.*, u.nome, u.cognome FROM presenze p JOIN utenti u ON u.id = p.utente_id WHERE seduta_id = ? ORDER BY p.id`).all(sedutaId) as any[];
  }

  // ---------- Votazioni ----------

  creaVotazione(attore: Utente, sedutaId: string, d: { oggetto: string; descrizione?: string; tipo: 'palese' | 'segreta'; opzioni?: string[]; maxScelte?: number }) {
    const s = this.seduta(sedutaId);
    this.soloPresidenza(attore, s);
    if (s.stato === 'chiusa') throw new RegistryError('stato', 'Seduta chiusa', 409);
    const opzioni = d.opzioni?.length ? d.opzioni.map((o) => o.trim()).filter(Boolean) : [...OPZIONI_DELIBERA];
    if (new Set(opzioni).size !== opzioni.length || opzioni.length < 2) throw new RegistryError('opzioni', 'Servono almeno due opzioni distinte');
    const deliberativa = !d.opzioni?.length || OPZIONI_DELIBERA.every((o, i) => opzioni[i] === o);
    const maxScelte = Math.max(1, Math.min(d.maxScelte ?? 1, opzioni.length));
    const numero = ((this.db.prepare('SELECT MAX(numero) AS n FROM votazioni WHERE seduta_id = ?').get(sedutaId) as any).n ?? 0) + 1;
    const id = randomUUID();
    this.db.prepare(`INSERT INTO votazioni (id, seduta_id, numero, oggetto, descrizione, tipo, opzioni, max_scelte, deliberativa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sedutaId, numero, d.oggetto.trim(), d.descrizione ?? '', d.tipo, JSON.stringify(opzioni), maxScelte, deliberativa ? 1 : 0);
    this.audit.append('votazione.creata', { id, sedutaId, numero, oggetto: d.oggetto, tipo: d.tipo, opzioni, maxScelte }, attore.id);
    return id;
  }

  votazione(id: string) {
    const v = this.db.prepare('SELECT * FROM votazioni WHERE id = ?').get(id) as any;
    if (!v) throw new RegistryError('nonTrovata', 'Votazione non trovata', 404);
    return v as {
      id: string; seduta_id: string; numero: number; oggetto: string; descrizione: string; tipo: 'palese' | 'segreta'; opzioni: string;
      max_scelte: number; deliberativa: number; stato: 'bozza' | 'aperta' | 'chiusa' | 'annullata'; aventi_diritto: string | null;
      presenti: number | null; componenti: number | null; aperta_il: string | null; chiusa_il: string | null; chiave_pub: string | null;
      chiave_priv: string | null; esito: string | null; radice: string | null; ripete_id: string | null; motivo_annullamento: string | null;
    };
  }

  votazioni(sedutaId: string) {
    return (this.db.prepare('SELECT * FROM votazioni WHERE seduta_id = ? ORDER BY numero').all(sedutaId) as any[]).map((v) => this.vistaVotazione(v));
  }

  vistaVotazione(v: ReturnType<RegistryService['votazione']>) {
    return {
      id: v.id, numero: v.numero, oggetto: v.oggetto, descrizione: v.descrizione, tipo: v.tipo, opzioni: JSON.parse(v.opzioni) as string[],
      maxScelte: v.max_scelte, deliberativa: !!v.deliberativa, stato: v.stato, presenti: v.presenti, componenti: v.componenti,
      aventiDiritto: v.aventi_diritto ? (JSON.parse(v.aventi_diritto) as string[]).length : null,
      apertaIl: v.aperta_il, chiusaIl: v.chiusa_il, chiavePubblica: v.chiave_pub,
      esito: v.esito ? JSON.parse(v.esito) as Esito : null, radice: v.radice, ripeteId: v.ripete_id, motivoAnnullamento: v.motivo_annullamento,
    };
  }

  async apriVotazione(attore: Utente, votazioneId: string) {
    const v = this.votazione(votazioneId);
    const s = this.seduta(v.seduta_id);
    this.soloPresidenza(attore, s);
    if (s.stato !== 'aperta') throw new RegistryError('stato', 'La seduta non è aperta', 409);
    if (v.stato !== 'bozza') throw new RegistryError('stato', 'La votazione non è in bozza', 409);
    const altra = this.db.prepare(`SELECT 1 FROM votazioni WHERE seduta_id = ? AND stato = 'aperta'`).get(v.seduta_id);
    if (altra) throw new RegistryError('altraAperta', 'C\'è già una votazione aperta', 409);
    const q = this.quorum(v.seduta_id);
    if (v.deliberativa && !q.ok) {
      throw new RegistryError('quorum', `Numero legale non raggiunto: presenti ${q.presenti}, richiesti ${q.richiesto} su ${q.componenti}`, 409);
    }
    const aventi = this.presenti(v.seduta_id).map((p) => p.id);
    let pub: string | null = null; let priv: string | null = null;
    if (v.tipo === 'segreta') {
      const k = await generateBlindKeyPair();
      pub = k.publicKeySpki; priv = k.privateKeyPkcs8;
      await this.urna.apri(v.id, pub, JSON.parse(v.opzioni), v.max_scelte);
    }
    this.db.prepare(`UPDATE votazioni SET stato = 'aperta', aventi_diritto = ?, presenti = ?, componenti = ?, aperta_il = ?, chiave_pub = ?, chiave_priv = ? WHERE id = ?`)
      .run(JSON.stringify(aventi), q.presenti, q.componenti, this.ts(), pub, priv, v.id);
    this.audit.append('votazione.aperta', { id: v.id, aventiDiritto: aventi.length, presenti: q.presenti, componenti: q.componenti, quorumOk: q.ok }, attore.id);
  }

  private aventeDiritto(v: ReturnType<RegistryService['votazione']>, utenteId: string) {
    return (JSON.parse(v.aventi_diritto ?? '[]') as string[]).includes(utenteId);
  }

  votoPalese(attore: Utente, votazioneId: string, scelte: string[]) {
    const v = this.votazione(votazioneId);
    if (v.tipo !== 'palese') throw new RegistryError('tipo', 'Questa è una votazione segreta', 400);
    if (v.stato !== 'aperta') throw new RegistryError('stato', 'La votazione non è aperta', 409);
    if (!this.aventeDiritto(v, attore.id)) throw new RegistryError('diritto', 'Non risulti tra gli aventi diritto al voto (presenti all\'apertura)', 403);
    const opzioni = JSON.parse(v.opzioni) as string[];
    if (scelte.length < 1 || scelte.length > v.max_scelte || new Set(scelte).size !== scelte.length || scelte.some((s) => !opzioni.includes(s))) {
      throw new RegistryError('scelta', 'Scelta non valida');
    }
    try {
      this.db.prepare('INSERT INTO voti_palesi (votazione_id, utente_id, scelta, ts) VALUES (?, ?, ?, ?)')
        .run(v.id, attore.id, JSON.stringify(scelte), this.ts());
    } catch {
      throw new RegistryError('giaVotato', 'Hai già votato', 409);
    }
    this.audit.append('voto.palese', { votazioneId: v.id, scelte }, attore.id);
  }

  /**
   * Voto segreto, passo 1: il Registro firma alla cieca il gettone dell'avente diritto.
   * Il Registro registra solo che il gettone è stato rilasciato (senza orario nella tabella),
   * non vede il gettone in chiaro e non saprà mai quale scheda lo userà.
   */
  async rilasciaGettone(attore: Utente, votazioneId: string, blindedMsgB64: string) {
    const v = this.votazione(votazioneId);
    if (v.tipo !== 'segreta') throw new RegistryError('tipo', 'Questa è una votazione palese', 400);
    if (v.stato !== 'aperta' || !v.chiave_priv) throw new RegistryError('stato', 'La votazione non è aperta', 409);
    if (!this.aventeDiritto(v, attore.id)) throw new RegistryError('diritto', 'Non risulti tra gli aventi diritto al voto (presenti all\'apertura)', 403);
    const gia = this.db.prepare('SELECT 1 FROM gettoni WHERE votazione_id = ? AND utente_id = ?').get(v.id, attore.id);
    if (gia) throw new RegistryError('giaVotato', 'Hai già ritirato il gettone per questa votazione', 409);
    const priv = await importBlindPrivate(v.chiave_priv);
    const blindSig = await blindSuite().blindSign(priv, b64u.dec(blindedMsgB64));
    try {
      this.db.prepare('INSERT INTO gettoni (votazione_id, utente_id) VALUES (?, ?)').run(v.id, attore.id);
    } catch {
      throw new RegistryError('giaVotato', 'Hai già ritirato il gettone per questa votazione', 409);
    }
    this.audit.append('voto.gettone_rilasciato', { votazioneId: v.id }, attore.id);
    return { blindSig: b64u.enc(blindSig) };
  }

  haVotato(utenteId: string, votazioneId: string) {
    const v = this.votazione(votazioneId);
    const t = v.tipo === 'palese' ? 'voti_palesi' : 'gettoni';
    return !!this.db.prepare(`SELECT 1 FROM ${t} WHERE votazione_id = ? AND utente_id = ?`).get(votazioneId, utenteId);
  }

  async affluenza(votazioneId: string) {
    const v = this.votazione(votazioneId);
    const aventi = (JSON.parse(v.aventi_diritto ?? '[]') as string[]).length;
    if (v.tipo === 'palese') {
      const n = (this.db.prepare('SELECT COUNT(*) AS n FROM voti_palesi WHERE votazione_id = ?').get(v.id) as any).n;
      return { aventi, votanti: n };
    }
    const gettoni = (this.db.prepare('SELECT COUNT(*) AS n FROM gettoni WHERE votazione_id = ?').get(v.id) as any).n;
    const schede = v.stato === 'aperta' || v.stato === 'chiusa' ? await this.urna.conteggio(v.id) : 0;
    return { aventi, votanti: schede, gettoni };
  }

  async chiudiVotazione(attore: Utente, votazioneId: string) {
    const v = this.votazione(votazioneId);
    const s = this.seduta(v.seduta_id);
    this.soloPresidenza(attore, s);
    if (v.stato !== 'aperta') throw new RegistryError('stato', 'La votazione non è aperta', 409);
    const opzioni = JSON.parse(v.opzioni) as string[];
    let esito: Esito; let radice: string | null = null;
    if (v.tipo === 'palese') {
      const voti = this.db.prepare('SELECT utente_id, scelta FROM voti_palesi WHERE votazione_id = ?').all(v.id) as { utente_id: string; scelta: string }[];
      const counts: Record<string, number> = Object.fromEntries(opzioni.map((o) => [o, 0]));
      for (const r of voti) for (const c of JSON.parse(r.scelta) as string[]) counts[c]++;
      const votoPres = voti.find((r) => r.utente_id === s.presidente_id);
      esito = { counts, votanti: voti.length, bianche: 0, validi: 0 };
      if (v.deliberativa) Object.assign(esito, calcolaEsitoDelibera(counts, { tipo: 'palese', astenutiComputati: !!s.astenuti_computati, votoPresidente: votoPres ? JSON.parse(votoPres.scelta)[0] : null }));
      else esito.validi = voti.length;
    } else {
      const gettoni = (this.db.prepare('SELECT COUNT(*) AS n FROM gettoni WHERE votazione_id = ?').get(v.id) as any).n;
      const r = await this.urna.chiudi(v.id, gettoni);
      radice = r.root;
      esito = { counts: r.tally.counts, votanti: r.tally.schede, bianche: r.tally.bianche, validi: r.tally.schede - r.tally.bianche, anomalia: r.anomaly };
      if (v.deliberativa) Object.assign(esito, calcolaEsitoDelibera(r.tally.counts, { tipo: 'segreta', astenutiComputati: !!s.astenuti_computati }));
    }
    // La chiave privata di firma viene distrutta: nessun nuovo gettone potrà essere emesso.
    this.db.prepare(`UPDATE votazioni SET stato = 'chiusa', chiusa_il = ?, esito = ?, radice = ?, chiave_priv = NULL WHERE id = ?`)
      .run(this.ts(), JSON.stringify(esito), radice, v.id);
    this.audit.append('votazione.chiusa', { id: v.id, esito, radice }, attore.id);
    return esito;
  }

  /**
   * Malfunzionamento (Allegato tecnico §8): la votazione viene annullata con motivazione
   * e, se richiesto, ne viene creata una copia da ripetere.
   */
  async annullaVotazione(attore: Utente, votazioneId: string, motivo: string, ripeti: boolean) {
    const v = this.votazione(votazioneId);
    const s = this.seduta(v.seduta_id);
    this.soloPresidenza(attore, s);
    if (v.stato === 'annullata') throw new RegistryError('stato', 'Già annullata', 409);
    if (!motivo?.trim()) throw new RegistryError('motivo', 'Indica il motivo dell\'annullamento');
    if (v.tipo === 'segreta' && v.stato === 'aperta') {
      const gettoni = (this.db.prepare('SELECT COUNT(*) AS n FROM gettoni WHERE votazione_id = ?').get(v.id) as any).n;
      await this.urna.chiudi(v.id, gettoni);
    }
    this.db.prepare(`UPDATE votazioni SET stato = 'annullata', motivo_annullamento = ?, chiave_priv = NULL, chiusa_il = COALESCE(chiusa_il, ?) WHERE id = ?`)
      .run(motivo.trim(), this.ts(), v.id);
    this.audit.append('votazione.annullata', { id: v.id, motivo, ripeti }, attore.id);
    if (!ripeti) return null;
    const nuova = this.creaVotazione(attore, v.seduta_id, {
      oggetto: v.oggetto, descrizione: v.descrizione, tipo: v.tipo,
      opzioni: v.deliberativa ? undefined : JSON.parse(v.opzioni), maxScelte: v.max_scelte,
    });
    this.db.prepare('UPDATE votazioni SET ripete_id = ? WHERE id = ?').run(v.id, nuova);
    return nuova;
  }

  votiPalesi(votazioneId: string) {
    return (this.db.prepare(`SELECT u.cognome, u.nome, vp.scelta FROM voti_palesi vp JOIN utenti u ON u.id = vp.utente_id WHERE votazione_id = ? ORDER BY u.cognome, u.nome`).all(votazioneId) as any[])
      .map((r) => ({ cognome: r.cognome, nome: r.nome, scelte: JSON.parse(r.scelta) as string[] }));
  }

  // ---------- Verbali ----------

  verbale(sedutaId: string) {
    const r = this.db.prepare('SELECT pdf, sha256, firma, generato FROM verbali WHERE seduta_id = ?').get(sedutaId) as any;
    return r ? { pdf: new Uint8Array(r.pdf), sha256: r.sha256 as string, firma: r.firma as string, generato: r.generato as string } : null;
  }

  salvaVerbale(sedutaId: string, pdf: Uint8Array, sha256: string, firma: string) {
    this.db.prepare('INSERT OR IGNORE INTO verbali (seduta_id, sha256, firma, generato, pdf) VALUES (?, ?, ?, ?, ?)').run(sedutaId, sha256, firma, this.ts(), pdf);
    this.audit.append('verbale.generato', { sedutaId, sha256, firma }, 'sistema');
  }

  verbalePerHash(sha256: string) {
    return this.db.prepare(`SELECT v.sha256, v.firma, v.generato, s.titolo, o.nome AS organo FROM verbali v JOIN sedute s ON s.id = v.seduta_id JOIN organi o ON o.id = s.organo_id WHERE v.sha256 = ?`).get(sha256) as
      { sha256: string; firma: string; generato: string; titolo: string; organo: string } | undefined;
  }

  // ---------- Permessi ----------

  soloAdmin(u: Utente) {
    if (u.ruolo !== 'admin') throw new RegistryError('permesso', 'Operazione riservata alla segreteria/dirigenza', 403);
  }

  soloPresidenza(u: Utente, s: { presidente_id: string; segretario_id: string }) {
    if (u.ruolo !== 'admin' && u.id !== s.presidente_id && u.id !== s.segretario_id) {
      throw new RegistryError('permesso', 'Operazione riservata a presidente e segretario', 403);
    }
  }

  organo(id: string) {
    const o = this.db.prepare('SELECT * FROM organi WHERE id = ?').get(id) as any;
    if (!o) throw new RegistryError('nonTrovato', 'Organo non trovato', 404);
    return o as { id: string; nome: string; tipo: TipoOrgano };
  }

  impostazione(chiave: string): string | null {
    return (this.db.prepare('SELECT valore FROM impostazioni WHERE chiave = ?').get(chiave) as any)?.valore ?? null;
  }
  setImpostazione(chiave: string, valore: string) {
    this.db.prepare('INSERT INTO impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore').run(chiave, valore);
  }
}
