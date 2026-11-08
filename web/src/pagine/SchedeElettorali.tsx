import { useEffect, useState, type FormEvent } from 'react';
import { api, fmtDataOra, trasporto } from '../api.ts';
import { deposita, DepositoError, votaSegreto, type SchedaPendente } from '../votoSegreto.ts';

interface Scheda {
  elezioneId: string; titolo: string; componente: string; stato: 'aperta' | 'chiusa'; apertura: string; chiusura: string;
  classeId: string; classe: string; posti: number; preferenze: number; hoVotato: boolean; candidati: string[]; eletti: string[] | null;
}

/** Schede elettorali dell'utente (genitore o studente), una per classe. */
export function SchedeElettorali() {
  const [schede, setSchede] = useState<Scheda[] | null>(null);
  const carica = () => api.get<Scheda[]>('/mie-schede').then(setSchede).catch(() => setSchede([]));
  useEffect(() => { carica(); }, []);
  if (!schede || schede.length === 0) return null;
  return (
    <section aria-labelledby="t-elez" style={{ marginBottom: 24 }}>
      <h2 id="t-elez">Elezioni dei rappresentanti</h2>
      {schede.map((s) => <SchedaClasse key={s.classeId} s={s} onVotato={carica} />)}
    </section>
  );
}

function SchedaClasse({ s, onVotato }: { s: Scheda; onVotato: () => void }) {
  const [scelte, setScelte] = useState<string[]>([]);
  const [filtro, setFiltro] = useState('');
  const [errore, setErrore] = useState('');
  const [ricevuta, setRicevuta] = useState('');
  const [invio, setInvio] = useState(false);
  const [pendente, setPendente] = useState<SchedaPendente | null>(null);
  const ora = Date.now();
  const inFinestra = s.stato === 'aperta' && ora >= Date.parse(s.apertura) && ora <= Date.parse(s.chiusura);
  const chi = s.componente === 'genitori' ? 'dei genitori' : 'degli studenti';

  const intestazione = (
    <>
      <h3 id={`cl-${s.classeId}`}>Classe {s.classe} · rappresentanti {chi}</h3>
      <p className="muto piccolo">{s.titolo} · seggio aperto dal {fmtDataOra(s.apertura)} al {fmtDataOra(s.chiusura)}</p>
    </>
  );

  if (s.stato === 'chiusa') return (
    <div className="scheda">{intestazione}
      <p><strong>Eletti:</strong> {s.eletti?.length ? s.eletti.join(', ') : 'nessuno'}</p>
    </div>
  );
  if (ricevuta) return (
    <div className="scheda">{intestazione}
      <div className="avviso ok" role="status"><strong>Voto registrato.</strong> Ricevuta da conservare: <div className="ricevuta">{ricevuta}</div></div>
    </div>
  );
  if (s.hoVotato && !pendente) return <div className="scheda">{intestazione}<div className="avviso ok">Hai già votato per questa classe. I risultati saranno pubblicati alla chiusura del seggio.</div></div>;
  if (!inFinestra) return <div className="scheda">{intestazione}<div className="avviso">Il seggio non è aperto in questo momento.</div></div>;

  const invia = async (e: FormEvent) => {
    e.preventDefault(); setErrore(''); setInvio(true);
    try {
      setRicevuta(pendente ? await deposita(trasporto, pendente) : await votaSegreto(trasporto, s.classeId, scelte, `/elezioni/classi/${s.classeId}/gettone`));
      setPendente(null); onVotato();
    } catch (err: any) {
      if (err instanceof DepositoError) { setPendente(err.pendente); setErrore('Il voto non è ancora stato depositato per un problema di rete. Premi "Riprova invio": il tuo gettone è conservato.'); }
      else setErrore(err.message);
    } finally { setInvio(false); }
  };

  const visibili = s.candidati.filter((c) => c.toLowerCase().includes(filtro.toLowerCase()));
  const pieno = scelte.length >= s.preferenze;
  return (
    <form className="scheda" style={{ borderColor: 'var(--blu)', borderWidth: 2 }} onSubmit={invia} aria-labelledby={`cl-${s.classeId}`}>
      {intestazione}
      <p><span className="etichetta">Voto segreto</span> <span className="piccolo muto">Nessuno può collegare il tuo nome alla tua scelta. Sono eleggibili tutti gli elettori della classe.</span></p>
      <p>Posti da coprire: <strong>{s.posti}</strong>. Puoi esprimere fino a <strong>{s.preferenze}</strong> {s.preferenze === 1 ? 'preferenza' : 'preferenze'}, oppure lasciare la scheda bianca.</p>
      {s.candidati.length > 8 && (
        <>
          <label htmlFor={`f-${s.classeId}`}>Cerca un nome</label>
          <input id={`f-${s.classeId}`} type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </>
      )}
      <fieldset disabled={!!pendente}>
        <legend>Scegli {s.preferenze === 1 ? 'un nome' : `fino a ${s.preferenze} nomi`} <span className="piccolo muto" aria-live="polite">({scelte.length} di {s.preferenze} selezionati)</span></legend>
        {visibili.map((c) => {
          const sel = scelte.includes(c);
          return (
            <label key={c} className="opzione">
              <input type={s.preferenze === 1 ? 'radio' : 'checkbox'} name={`c-${s.classeId}`} checked={sel} disabled={!sel && pieno && s.preferenze > 1}
                onChange={(e) => setScelte(s.preferenze === 1 ? [c] : e.target.checked ? [...scelte, c] : scelte.filter((x) => x !== c))} />
              {c}
            </label>
          );
        })}
      </fieldset>
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      <div className="riga-azioni">
        <button disabled={invio}>{pendente ? 'Riprova invio' : invio ? 'Invio in corso…' : scelte.length ? 'Conferma il voto' : 'Vota scheda bianca'}</button>
        {scelte.length > 0 && !pendente && <button type="button" className="secondario" onClick={() => setScelte([])}>Azzera</button>}
        <span className="piccolo muto">Il voto non può essere modificato dopo la conferma.</span>
      </div>
    </form>
  );
}
