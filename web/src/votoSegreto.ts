import { RSABSSA } from '@cloudflare/blindrsa-ts';

const enc = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const dec = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export interface Trasporto {
  /** Chiamata al Registro (con cookie di sessione). */
  registro(path: string, body: unknown): Promise<any>;
  /** Chiamata all'Urna (SENZA cookie né identità). */
  urna(path: string, body?: unknown): Promise<any>;
}

/**
 * Voto segreto lato client (RFC 9474):
 * 1. genera un gettone casuale e lo "acceca" con la chiave pubblica della votazione;
 * 2. il Registro, che sa chi sei, firma il gettone accecato senza vederlo;
 * 3. il client toglie l'accecamento e ottiene una firma valida sul gettone in chiaro;
 * 4. deposita gettone + firma + scelta nell'Urna, che non sa chi sei.
 * Restituisce la ricevuta (SHA-256 del gettone) da ritrovare nella bacheca pubblica.
 */
export async function votaSegreto(t: Trasporto, votazioneId: string, scelte: string[], percorsoGettone = `/votazioni/${votazioneId}/gettone`): Promise<string> {
  const info = await t.urna(`/urne/${votazioneId}`);
  // Controllo preventivo: una scheda non valida non deve consumare il gettone.
  if (scelte.length > info.maxChoices || new Set(scelte).size !== scelte.length || scelte.some((s) => !info.options.includes(s))) {
    throw Object.assign(new Error(`Scelta non valida: puoi indicare al massimo ${info.maxChoices} preferenze tra i nomi in elenco`), { status: 400 });
  }
  const suite = RSABSSA.SHA384.PSS.Randomized();
  const pk = await crypto.subtle.importKey('spki', dec(info.publicKey), { name: 'RSA-PSS', hash: 'SHA-384' }, true, ['verify']);
  const gettone = crypto.getRandomValues(new Uint8Array(32));
  const msg = suite.prepare(gettone);
  const { blindedMsg, inv } = await suite.blind(pk, msg);
  const { blindSig } = await t.registro(percorsoGettone, { blindedMsg: enc(blindedMsg) });
  const sig = await suite.finalize(pk, msg, dec(blindSig), inv);
  return deposita(t, { votazioneId, msg: enc(msg), sig: enc(sig), scelte });
}

export interface SchedaPendente { votazioneId: string; msg: string; sig: string; scelte: string[] }

/** Errore dopo il ritiro del gettone: la scheda può essere reinviata con `deposita`. */
export class DepositoError extends Error {
  constructor(public pendente: SchedaPendente, causa: unknown) {
    super(`Gettone ottenuto ma invio della scheda non riuscito: ${(causa as Error)?.message ?? causa}`);
  }
}

export async function deposita(t: Trasporto, p: SchedaPendente): Promise<string> {
  let ultimo: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const { receipt } = await t.urna(`/urne/${p.votazioneId}/schede`, { msg: p.msg, sig: p.sig, choice: p.scelte });
      return receipt as string;
    } catch (e: any) {
      ultimo = e;
      if (e?.status && e.status < 500) break;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new DepositoError(p, ultimo);
}
