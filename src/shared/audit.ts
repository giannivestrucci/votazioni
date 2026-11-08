import type { DB } from './db.ts';
import { sha256hex } from './crypto.ts';

export const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit append-only'); END;
`;

const GENESIS = '0'.repeat(64);

/**
 * Registro di audit append-only a catena di hash (Allegato tecnico §2 punto 4, §5, §7).
 * Ogni voce include l'hash della precedente: una modifica a posteriori rompe la catena.
 */
export class AuditLog {
  constructor(private db: DB, private now: () => Date = () => new Date()) {}

  append(action: string, payload: unknown, actor: string | null = null) {
    const last = this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const ts = this.now().toISOString();
    const body = JSON.stringify(payload ?? {});
    const hash = sha256hex(`${prev}|${ts}|${actor ?? ''}|${action}|${body}`);
    this.db.prepare('INSERT INTO audit (ts, actor, action, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ts, actor, action, body, prev, hash);
    return hash;
  }

  head(): string {
    const last = this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
    return last?.hash ?? GENESIS;
  }

  verify(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (const r of this.db.prepare('SELECT * FROM audit ORDER BY seq').all() as any[]) {
      const h = sha256hex(`${prev}|${r.ts}|${r.actor ?? ''}|${r.action}|${r.payload}`);
      if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq };
      prev = r.hash;
    }
    return { ok: true };
  }

  list(filter?: { like?: string }) {
    if (filter?.like) return this.db.prepare('SELECT * FROM audit WHERE payload LIKE ? ORDER BY seq').all(`%${filter.like}%`);
    return this.db.prepare('SELECT * FROM audit ORDER BY seq').all();
  }
}
