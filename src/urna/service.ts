import type { DB } from '../shared/db.ts';
import { tx } from '../shared/db.ts';
import { AuditLog, AUDIT_SCHEMA } from '../shared/audit.ts';
import { blindSuite, b64u, importBlindPublic, sha256hex } from '../shared/crypto.ts';

/**
 * Servizio Urna. Conosce i voti ma NON le identità:
 * - non riceve cookie di sessione (il cookie del Registro ha Path=/api);
 * - non registra IP, user agent né orari delle singole schede;
 * - le schede sono in una tabella WITHOUT ROWID con chiave casuale, quindi
 *   il database non conserva nemmeno l'ordine di inserimento.
 */
export const URNA_SCHEMA = `
CREATE TABLE IF NOT EXISTS urne (
  motion_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  options TEXT NOT NULL,
  max_choices INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('aperta','chiusa')),
  tokens_issued INTEGER,
  root TEXT,
  tally TEXT,
  anomaly TEXT
);
CREATE TABLE IF NOT EXISTS schede (
  receipt TEXT PRIMARY KEY,
  motion_id TEXT NOT NULL REFERENCES urne(motion_id),
  msg TEXT NOT NULL,
  sig TEXT NOT NULL,
  choice TEXT NOT NULL
) WITHOUT ROWID;
${AUDIT_SCHEMA}
`;

export class UrnaError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface Tally { counts: Record<string, number>; schede: number; bianche: number }
export interface CloseResult { tally: Tally; root: string; receipts: string[]; anomaly: string | null }

export class UrnaService {
  readonly audit: AuditLog;
  constructor(private db: DB) { this.audit = new AuditLog(db); }

  apri(motionId: string, publicKey: string, options: string[], maxChoices = 1) {
    if (options.length < 1) throw new UrnaError('opzioni', 'Servono almeno un\'opzione');
    const exists = this.db.prepare('SELECT 1 FROM urne WHERE motion_id = ?').get(motionId);
    if (exists) throw new UrnaError('esiste', 'Urna già aperta per questa votazione', 409);
    this.db.prepare('INSERT INTO urne (motion_id, public_key, options, max_choices, status) VALUES (?, ?, ?, ?, ?)')
      .run(motionId, publicKey, JSON.stringify(options), maxChoices, 'aperta');
    this.audit.append('urna.aperta', { motionId, options, maxChoices, publicKeyHash: sha256hex(publicKey) });
  }

  info(motionId: string) {
    const u = this.get(motionId);
    return {
      motionId, status: u.status, publicKey: u.public_key,
      options: JSON.parse(u.options) as string[], maxChoices: u.max_choices,
    };
  }

  /** Deposita una scheda. `choice` è un array di opzioni (vuoto = scheda bianca). */
  async deposita(motionId: string, msgB64: string, sigB64: string, choice: string[]): Promise<{ receipt: string }> {
    const u = this.get(motionId);
    if (u.status !== 'aperta') throw new UrnaError('chiusa', 'La votazione è chiusa', 409);
    const options = JSON.parse(u.options) as string[];
    if (!Array.isArray(choice) || choice.length > u.max_choices || new Set(choice).size !== choice.length
      || choice.some((c) => !options.includes(c))) {
      throw new UrnaError('scelta', 'Scelta non valida');
    }
    const msg = b64u.dec(msgB64);
    const sig = b64u.dec(sigB64);
    const pk = await importBlindPublic(u.public_key);
    let ok = false;
    try { ok = await blindSuite().verify(pk, sig, msg); } catch { ok = false; }
    if (!ok) throw new UrnaError('gettone', 'Gettone di voto non valido', 403);
    const receipt = sha256hex(msg);
    return tx(this.db, () => {
      const again = this.db.prepare('SELECT status FROM urne WHERE motion_id = ?').get(motionId) as { status: string };
      if (again.status !== 'aperta') throw new UrnaError('chiusa', 'La votazione è chiusa', 409);
      const dup = this.db.prepare('SELECT 1 FROM schede WHERE receipt = ?').get(receipt);
      if (dup) throw new UrnaError('usato', 'Questo gettone è già stato usato', 409);
      const sorted = [...choice].sort();
      this.db.prepare('INSERT INTO schede (receipt, motion_id, msg, sig, choice) VALUES (?, ?, ?, ?, ?)')
        .run(receipt, motionId, msgB64, sigB64, JSON.stringify(sorted));
      return { receipt };
    });
  }

  /** Numero di schede depositate (affluenza), senza rivelare i contenuti. */
  conteggio(motionId: string): number {
    this.get(motionId);
    return (this.db.prepare('SELECT COUNT(*) AS n FROM schede WHERE motion_id = ?').get(motionId) as { n: number }).n;
  }

  chiudi(motionId: string, tokensIssued: number): CloseResult {
    return tx(this.db, () => {
      const u = this.get(motionId);
      if (u.status === 'chiusa') return this.risultato(motionId)!;
      const options = JSON.parse(u.options) as string[];
      const rows = this.db.prepare('SELECT receipt, choice FROM schede WHERE motion_id = ? ORDER BY receipt').all(motionId) as { receipt: string; choice: string }[];
      const counts: Record<string, number> = Object.fromEntries(options.map((o) => [o, 0]));
      let bianche = 0;
      for (const r of rows) {
        const c = JSON.parse(r.choice) as string[];
        if (c.length === 0) bianche++;
        for (const o of c) counts[o]++;
      }
      const receipts = rows.map((r) => r.receipt);
      const root = sha256hex(receipts.join('\n'));
      const tally: Tally = { counts, schede: rows.length, bianche };
      const anomaly = rows.length > tokensIssued
        ? `Schede (${rows.length}) superiori ai gettoni rilasciati (${tokensIssued})` : null;
      this.db.prepare('UPDATE urne SET status = ?, tokens_issued = ?, root = ?, tally = ?, anomaly = ? WHERE motion_id = ?')
        .run('chiusa', tokensIssued, root, JSON.stringify(tally), anomaly, motionId);
      this.audit.append('urna.chiusa', { motionId, tokensIssued, schede: rows.length, root, tally, anomaly });
      return { tally, root, receipts, anomaly };
    });
  }

  /** Bacheca pubblica a urna chiusa: ricevute in ordine lessicografico, esito, radice. */
  risultato(motionId: string): CloseResult | null {
    const u = this.get(motionId);
    if (u.status !== 'chiusa') return null;
    const receipts = (this.db.prepare('SELECT receipt FROM schede WHERE motion_id = ? ORDER BY receipt').all(motionId) as { receipt: string }[]).map((r) => r.receipt);
    return { tally: JSON.parse(u.tally!), root: u.root!, receipts, anomaly: u.anomaly };
  }

  private get(motionId: string) {
    const u = this.db.prepare('SELECT * FROM urne WHERE motion_id = ?').get(motionId) as any;
    if (!u) throw new UrnaError('nonTrovata', 'Votazione non trovata', 404);
    return u as { public_key: string; options: string; max_choices: number; status: string; root: string | null; tally: string | null; anomaly: string | null };
  }
}
