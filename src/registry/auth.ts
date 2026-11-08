import { randomInt, timingSafeEqual } from 'node:crypto';
import type { DB } from '../shared/db.ts';
import { randomToken, sha256hex } from '../shared/crypto.ts';
import type { AuditLog } from '../shared/audit.ts';

export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Invio di sviluppo: scrive il messaggio sulla console. In produzione va sostituito con SMTP. */
export class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, text: string) {
    console.log(`\n[email] a: ${to}\n[email] oggetto: ${subject}\n${text}\n`);
  }
}

/**
 * Invio tramite SMTP (es. il server di posta della scuola o un servizio transazionale).
 * SMTP_URL: smtps://utente:password@smtp.esempio.it:465  ·  SMTP_FROM: "Votazioni <noreply@scuola.edu.it>"
 */
export class SmtpEmailSender implements EmailSender {
  private transport: Promise<{ sendMail: (o: object) => Promise<unknown> }>;
  constructor(url: string, private from: string) {
    this.transport = import('nodemailer').then((m) => m.default.createTransport(url));
  }
  async send(to: string, subject: string, text: string) {
    await (await this.transport).sendMail({ from: this.from, to, subject, text });
  }
}

export function emailSenderDaEnv(env: NodeJS.ProcessEnv): EmailSender {
  if (env.SMTP_URL) {
    if (!env.SMTP_FROM) throw new Error('SMTP_FROM obbligatorio insieme a SMTP_URL');
    return new SmtpEmailSender(env.SMTP_URL, env.SMTP_FROM);
  }
  if (env.NODE_ENV === 'production') throw new Error('In produzione configura SMTP_URL e SMTP_FROM per inviare i codici di accesso');
  return new ConsoleEmailSender();
}

export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 401) { super(message); }
}

export interface AuthConfig {
  otpTtlMs: number;
  otpMaxTentativi: number;
  otpIntervalloMs: number;
  sessioneTtlMs: number;
  inattivitaMs: number;
}

export const DEFAULT_AUTH: AuthConfig = {
  otpTtlMs: 10 * 60_000,
  otpMaxTentativi: 5,
  otpIntervalloMs: 30_000,
  sessioneTtlMs: 8 * 3600_000,
  inattivitaMs: 30 * 60_000,
};

/**
 * Autenticazione senza password: codice monouso (OTP) inviato alla casella istituzionale.
 * Allegato tecnico §3.2 (autenticazione adeguata al rischio) e §3.4 (sessioni):
 * - una sola sessione attiva per utente (un nuovo accesso chiude le precedenti);
 * - scadenza per inattività;
 * - token di sessione conservato solo come hash.
 */
export class AuthService {
  constructor(
    private db: DB,
    private audit: AuditLog,
    private mail: EmailSender,
    private cfg: AuthConfig = DEFAULT_AUTH,
    private now: () => Date = () => new Date(),
  ) {}

  /** Restituisce il codice solo per uso in sviluppo/test; le rotte lo espongono solo se DEV_OTP=1. */
  async richiediCodice(email: string): Promise<string | null> {
    const u = this.db.prepare('SELECT id, attivo FROM utenti WHERE email = ?').get(email) as { id: string; attivo: number } | undefined;
    // Risposta identica se l'utente non esiste, per non rivelare quali email sono registrate.
    if (!u || !u.attivo) return null;
    const prev = this.db.prepare('SELECT inviato FROM otp WHERE email = ?').get(email) as { inviato: string } | undefined;
    if (prev && this.now().getTime() - Date.parse(prev.inviato) < this.cfg.otpIntervalloMs) {
      throw new AuthError('attendi', 'Attendi qualche secondo prima di richiedere un nuovo codice', 429);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const scade = new Date(this.now().getTime() + this.cfg.otpTtlMs).toISOString();
    this.db.prepare(`INSERT INTO otp (email, code_hash, scade, tentativi, inviato) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, scade = excluded.scade, tentativi = 0, inviato = excluded.inviato`)
      .run(email, sha256hex(`${email.toLowerCase()}|${code}`), scade, this.now().toISOString());
    await this.mail.send(email, 'Codice di accesso - Votazioni', `Il tuo codice di accesso è ${code}. Scade tra 10 minuti. Non condividerlo con nessuno.`);
    this.audit.append('auth.codice_inviato', { email }, u.id);
    return code;
  }

  verificaCodice(email: string, code: string): { token: string; utenteId: string } {
    const row = this.db.prepare('SELECT * FROM otp WHERE email = ?').get(email) as any;
    if (!row) throw new AuthError('codice', 'Codice non valido o scaduto');
    if (row.tentativi >= this.cfg.otpMaxTentativi || Date.parse(row.scade) < this.now().getTime()) {
      this.db.prepare('DELETE FROM otp WHERE email = ?').run(email);
      throw new AuthError('codice', 'Codice non valido o scaduto');
    }
    const exp = Buffer.from(row.code_hash);
    const got = Buffer.from(sha256hex(`${email.toLowerCase()}|${code}`));
    if (!timingSafeEqual(exp, got)) {
      this.db.prepare('UPDATE otp SET tentativi = tentativi + 1 WHERE email = ?').run(email);
      throw new AuthError('codice', 'Codice non valido o scaduto');
    }
    this.db.prepare('DELETE FROM otp WHERE email = ?').run(email);
    const u = this.db.prepare('SELECT id FROM utenti WHERE email = ? AND attivo = 1').get(email) as { id: string };
    const token = randomToken(32);
    const now = this.now();
    this.db.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(u.id);
    this.db.prepare('INSERT INTO sessioni (id_hash, utente_id, scade, ultimo_uso) VALUES (?, ?, ?, ?)')
      .run(sha256hex(token), u.id, new Date(now.getTime() + this.cfg.sessioneTtlMs).toISOString(), now.toISOString());
    this.audit.append('auth.accesso', { email }, u.id);
    return { token, utenteId: u.id };
  }

  sessione(token: string | undefined): Utente | null {
    if (!token) return null;
    const h = sha256hex(token);
    const s = this.db.prepare('SELECT * FROM sessioni WHERE id_hash = ?').get(h) as any;
    if (!s) return null;
    const now = this.now().getTime();
    if (Date.parse(s.scade) < now || now - Date.parse(s.ultimo_uso) > this.cfg.inattivitaMs) {
      this.db.prepare('DELETE FROM sessioni WHERE id_hash = ?').run(h);
      return null;
    }
    this.db.prepare('UPDATE sessioni SET ultimo_uso = ? WHERE id_hash = ?').run(this.now().toISOString(), h);
    const u = this.db.prepare('SELECT id, email, nome, cognome, ruolo FROM utenti WHERE id = ? AND attivo = 1').get(s.utente_id) as Utente | undefined;
    return u ?? null;
  }

  esci(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessioni WHERE id_hash = ?').run(sha256hex(token));
  }
}

export interface Utente { id: string; email: string; nome: string; cognome: string; ruolo: 'admin' | 'utente' }
