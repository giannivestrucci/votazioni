import { AUDIT_SCHEMA } from '../shared/audit.ts';

export const REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS utenti (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  ruolo TEXT NOT NULL DEFAULT 'utente' CHECK (ruolo IN ('admin','utente')),
  attivo INTEGER NOT NULL DEFAULT 1,
  creato TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  scade TEXT NOT NULL,
  tentativi INTEGER NOT NULL DEFAULT 0,
  inviato TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessioni (
  id_hash TEXT PRIMARY KEY,
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  scade TEXT NOT NULL,
  ultimo_uso TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organi (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS componenti (
  organo_id TEXT NOT NULL REFERENCES organi(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  PRIMARY KEY (organo_id, utente_id)
);
CREATE TABLE IF NOT EXISTS sedute (
  id TEXT PRIMARY KEY,
  organo_id TEXT NOT NULL REFERENCES organi(id),
  titolo TEXT NOT NULL,
  odg TEXT NOT NULL DEFAULT '',
  data_ora TEXT NOT NULL,
  modalita TEXT NOT NULL CHECK (modalita IN ('distanza','mista','presenza')),
  presidente_id TEXT NOT NULL REFERENCES utenti(id),
  segretario_id TEXT NOT NULL REFERENCES utenti(id),
  astenuti_computati INTEGER NOT NULL DEFAULT 0,
  stato TEXT NOT NULL DEFAULT 'programmata' CHECK (stato IN ('programmata','aperta','chiusa')),
  aperta_il TEXT,
  chiusa_il TEXT,
  componenti_snapshot TEXT
);
CREATE TABLE IF NOT EXISTS presenze (
  id INTEGER PRIMARY KEY,
  seduta_id TEXT NOT NULL REFERENCES sedute(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrata','uscita')),
  modalita TEXT CHECK (modalita IN ('presenza','remoto')),
  ts TEXT NOT NULL,
  registrato_da TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votazioni (
  id TEXT PRIMARY KEY,
  seduta_id TEXT NOT NULL REFERENCES sedute(id),
  numero INTEGER NOT NULL,
  oggetto TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL CHECK (tipo IN ('palese','segreta')),
  opzioni TEXT NOT NULL,
  max_scelte INTEGER NOT NULL DEFAULT 1,
  deliberativa INTEGER NOT NULL DEFAULT 1,
  stato TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','aperta','chiusa','annullata')),
  aventi_diritto TEXT,
  presenti INTEGER,
  componenti INTEGER,
  aperta_il TEXT,
  chiusa_il TEXT,
  chiave_pub TEXT,
  chiave_priv TEXT,
  esito TEXT,
  radice TEXT,
  ripete_id TEXT REFERENCES votazioni(id),
  motivo_annullamento TEXT
);
CREATE TABLE IF NOT EXISTS voti_palesi (
  votazione_id TEXT NOT NULL REFERENCES votazioni(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  scelta TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (votazione_id, utente_id)
);
CREATE TRIGGER IF NOT EXISTS voti_palesi_immodificabili BEFORE UPDATE ON voti_palesi BEGIN SELECT RAISE(ABORT, 'voto immodificabile'); END;
CREATE TABLE IF NOT EXISTS gettoni (
  votazione_id TEXT NOT NULL REFERENCES votazioni(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  PRIMARY KEY (votazione_id, utente_id)
);
CREATE TABLE IF NOT EXISTS verbali (
  seduta_id TEXT PRIMARY KEY REFERENCES sedute(id),
  sha256 TEXT NOT NULL,
  firma TEXT NOT NULL,
  generato TEXT NOT NULL,
  pdf BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS impostazioni (
  chiave TEXT PRIMARY KEY,
  valore TEXT NOT NULL
);
${AUDIT_SCHEMA}
`;

/** Elezioni dei rappresentanti (O.M. 215/1991, procedura semplificata artt. 21-22). */
export const ELEZIONI_SCHEMA = `
CREATE TABLE IF NOT EXISTS elezioni (
  id TEXT PRIMARY KEY,
  titolo TEXT NOT NULL,
  componente TEXT NOT NULL CHECK (componente IN ('genitori','studenti')),
  apertura TEXT NOT NULL,
  chiusura TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','aperta','chiusa')),
  aperta_il TEXT,
  chiusa_il TEXT,
  creata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS elezione_classi (
  id TEXT PRIMARY KEY,
  elezione_id TEXT NOT NULL REFERENCES elezioni(id),
  classe TEXT NOT NULL,
  posti INTEGER NOT NULL,
  preferenze INTEGER NOT NULL,
  candidati TEXT,
  chiave_pub TEXT,
  chiave_priv TEXT,
  esito TEXT,
  radice TEXT,
  UNIQUE (elezione_id, classe)
);
CREATE TABLE IF NOT EXISTS elettori (
  classe_id TEXT NOT NULL REFERENCES elezione_classi(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  candidabile INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (classe_id, utente_id)
);
CREATE TABLE IF NOT EXISTS gettoni_elezione (
  classe_id TEXT NOT NULL REFERENCES elezione_classi(id),
  utente_id TEXT NOT NULL REFERENCES utenti(id),
  PRIMARY KEY (classe_id, utente_id)
);
CREATE TABLE IF NOT EXISTS verbali_elezione (
  elezione_id TEXT PRIMARY KEY REFERENCES elezioni(id),
  sha256 TEXT NOT NULL,
  firma TEXT NOT NULL,
  generato TEXT NOT NULL,
  pdf BLOB NOT NULL
);
`;
