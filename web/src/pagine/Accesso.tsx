import { useState, type FormEvent } from 'react';
import { api, type Utente } from '../api.ts';

export function Accesso({ onAccesso }: { onAccesso: (u: Utente) => void }) {
  const [email, setEmail] = useState('');
  const [codice, setCodice] = useState('');
  const [fase, setFase] = useState<'email' | 'codice'>('email');
  const [errore, setErrore] = useState('');
  const [info, setInfo] = useState('');
  const [attesa, setAttesa] = useState(false);

  const richiedi = async (e: FormEvent) => {
    e.preventDefault(); setErrore(''); setAttesa(true);
    try {
      const r = await api.post('/auth/codice', { email });
      setFase('codice');
      setInfo(r.codiceSviluppo
        ? `Modalità sviluppo: il codice è ${r.codiceSviluppo}`
        : 'Se l\'indirizzo è registrato, riceverai a breve un codice di 6 cifre.');
    } catch (err: any) { setErrore(err.message); } finally { setAttesa(false); }
  };

  const accedi = async (e: FormEvent) => {
    e.preventDefault(); setErrore(''); setAttesa(true);
    try { onAccesso(await api.post('/auth/accedi', { email, codice })); } catch (err: any) { setErrore(err.message); } finally { setAttesa(false); }
  };

  return (
    <div className="contenitore-login scheda">
      <h2>Accedi</h2>
      <p className="muto">Usa la tua casella di posta istituzionale. Non servono password.</p>
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      {fase === 'email' ? (
        <form onSubmit={richiedi}>
          <label htmlFor="email">Email istituzionale</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="riga-azioni"><button disabled={attesa}>Ricevi il codice</button></div>
        </form>
      ) : (
        <form onSubmit={accedi}>
          {info && <div className="avviso" role="status">{info}</div>}
          <label htmlFor="codice">Codice di accesso</label>
          <input id="codice" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={codice} onChange={(e) => setCodice(e.target.value.replace(/\D/g, ''))} aria-describedby="codice-aiuto" />
          <div id="codice-aiuto" className="aiuto">6 cifre, valido 10 minuti.</div>
          <div className="riga-azioni">
            <button disabled={attesa}>Accedi</button>
            <button type="button" className="secondario" onClick={() => { setFase('email'); setCodice(''); setInfo(''); }}>Cambia email</button>
          </div>
        </form>
      )}
    </div>
  );
}
