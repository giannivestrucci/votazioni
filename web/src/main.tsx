import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type Utente } from './api.ts';
import { Accesso } from './pagine/Accesso.tsx';
import { ElencoSedute } from './pagine/ElencoSedute.tsx';
import { PaginaSeduta } from './pagine/PaginaSeduta.tsx';
import { Amministrazione } from './pagine/Amministrazione.tsx';
import { Verifica } from './pagine/Verifica.tsx';
import { Elezioni } from './pagine/Elezioni.tsx';

function useRotta() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => { setH(location.hash.slice(1) || '/'); document.getElementById('contenuto')?.focus(); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

function App() {
  const rotta = useRotta();
  const [utente, setUtente] = useState<Utente | null | undefined>(undefined);

  useEffect(() => {
    api.get<Utente>('/me').then(setUtente).catch(() => setUtente(null));
    const scaduta = () => setUtente(null);
    addEventListener('sessione-scaduta', scaduta);
    return () => removeEventListener('sessione-scaduta', scaduta);
  }, []);

  const esci = async () => { await api.post('/auth/esci').catch(() => {}); setUtente(null); location.hash = '/'; };

  let pagina;
  if (rotta.startsWith('/verifica')) pagina = <Verifica />;
  else if (utente === undefined) pagina = <p>Caricamento…</p>;
  else if (!utente) pagina = <Accesso onAccesso={setUtente} />;
  else if (rotta.startsWith('/sedute/')) pagina = <PaginaSeduta id={rotta.split('/')[2]} utente={utente} />;
  else if (rotta.startsWith('/amministrazione') && utente.ruolo === 'admin') pagina = <Amministrazione />;
  else if (rotta.startsWith('/elezioni') && utente.ruolo === 'admin') pagina = <Elezioni id={rotta.split('/')[2]} />;
  else pagina = <ElencoSedute utente={utente} />;

  return (
    <>
      <a className="salta" href="#contenuto" onClick={(e) => { e.preventDefault(); document.getElementById('contenuto')?.focus(); }}>Vai al contenuto</a>
      <header className="testata">
        <div className="riga">
          <h1><a href="#/" style={{ textDecoration: 'none' }}>Votazioni · Organi collegiali</a></h1>
          <nav aria-label="Menu principale">
            {utente && <a href="#/">Home</a>}
            {utente?.ruolo === 'admin' && <a href="#/amministrazione">Organi e sedute</a>}
            {utente?.ruolo === 'admin' && <a href="#/elezioni">Elezioni</a>}
            <a href="#/verifica">Verifica verbale</a>
            {utente && <span className="piccolo">{utente.nome} {utente.cognome}</span>}
            {utente && <button className="link" onClick={esci}>Esci</button>}
          </nav>
        </div>
      </header>
      <main id="contenuto" tabIndex={-1}>{pagina}</main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
