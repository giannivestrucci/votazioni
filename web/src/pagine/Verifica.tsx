import { useState } from 'react';
import { api } from '../api.ts';

async function sha256File(f: File) {
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function Verifica() {
  const [esito, setEsito] = useState<any>(null);
  const [hash, setHash] = useState('');
  const [errore, setErrore] = useState('');

  const verifica = async (h: string) => {
    setErrore(''); setEsito(null);
    try { setEsito(await api.post('/pubblico/verifica', { sha256: h })); } catch (e: any) { setErrore(e.message); }
  };

  return (
    <div className="scheda" style={{ maxWidth: 680 }}>
      <h2>Verifica di un verbale</h2>
      <p>Carica il PDF del verbale: l'impronta viene calcolata sul tuo dispositivo e confrontata con quella registrata e firmata dalla piattaforma. Il file non viene inviato.</p>
      <label htmlFor="file">File del verbale (PDF)</label>
      <input id="file" type="file" accept="application/pdf" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const h = await sha256File(f); setHash(h); verifica(h);
      }} />
      {hash && <p className="piccolo">Impronta SHA-256: <span className="ricevuta">{hash}</span></p>}
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      <div aria-live="polite">
        {esito && (esito.trovato && esito.firmaValida
          ? <div className="avviso ok">Verbale autentico e integro: «{esito.seduta}» ({esito.organo}), generato il {new Date(esito.generato).toLocaleString('it-IT')}. Firma del sistema valida.</div>
          : <div className="avviso errore">Nessun verbale corrispondente: il file è stato modificato oppure non proviene da questa piattaforma.</div>)}
      </div>
    </div>
  );
}
