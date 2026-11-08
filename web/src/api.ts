import type { Trasporto } from './votoSegreto.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string, public codice?: string) { super(message); }
}

async function call(base: '/api' | '/urna', method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    // L'Urna non deve ricevere cookie: credentials 'omit' (il cookie ha comunque Path=/api).
    credentials: base === '/api' ? 'same-origin' : 'omit',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && base === '/api') window.dispatchEvent(new Event('sessione-scaduta'));
    throw new ApiError(r.status, data?.messaggio ?? `Errore ${r.status}`, data?.errore);
  }
  return data;
}

export const api = {
  get: <T = any>(p: string): Promise<T> => call('/api', 'GET', p),
  post: <T = any>(p: string, b: unknown = {}): Promise<T> => call('/api', 'POST', p, b),
  del: <T = any>(p: string): Promise<T> => call('/api', 'DELETE', p),
};

export const trasporto: Trasporto = {
  registro: (p, b) => call('/api', 'POST', p, b),
  urna: (p, b) => call('/urna', b === undefined ? 'GET' : 'POST', p, b),
};

export interface Utente { id: string; email: string; nome: string; cognome: string; ruolo: 'admin' | 'utente' }

export interface Votazione {
  id: string; numero: number; oggetto: string; descrizione: string; tipo: 'palese' | 'segreta'; opzioni: string[]; maxScelte: number;
  deliberativa: boolean; stato: 'bozza' | 'aperta' | 'chiusa' | 'annullata'; presenti: number | null; componenti: number | null;
  aventiDiritto: number | null; apertaIl: string | null; chiusaIl: string | null; radice: string | null; ripeteId: string | null;
  motivoAnnullamento: string | null; hoVotato: boolean; possoVotare: boolean;
  esito: null | { counts: Record<string, number>; votanti: number; bianche: number; validi: number; risultato?: 'approvata' | 'respinta'; motivazione?: string; anomalia?: string | null };
  affluenza: null | { aventi: number; votanti: number; gettoni?: number };
  votiPalesi?: { nome: string; cognome: string; scelte: string[] }[];
}

export interface Seduta {
  id: string; titolo: string; odg: string; dataOra: string; modalita: 'distanza' | 'mista' | 'presenza'; stato: 'programmata' | 'aperta' | 'chiusa';
  apertaIl: string | null; chiusaIl: string | null; organo: { id: string; nome: string; tipo: string }; astenutiComputati: boolean;
  presidente: { id: string; nome: string }; segretario: { id: string; nome: string };
  quorum: { componenti: number; presenti: number; richiesto: number; ok: boolean };
  presenti: { id: string; nome: string; cognome: string; modalita: 'presenza' | 'remoto' }[];
  componenti?: { id: string; nome: string; cognome: string }[];
  votazioni: Votazione[];
  io: { id: string; presidenza: boolean; presente: 'presenza' | 'remoto' | null };
}

export const fmtDataOra = (iso: string) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' });
export const fmtOra = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
