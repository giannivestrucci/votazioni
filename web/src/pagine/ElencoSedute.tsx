import { useEffect, useState } from 'react';
import { api, fmtDataOra, type Utente } from '../api.ts';

const STATO: Record<string, [string, string]> = {
  programmata: ['Programmata', ''],
  aperta: ['In corso', 'verde'],
  chiusa: ['Chiusa', 'ambra'],
};

export function ElencoSedute({ utente }: { utente: Utente }) {
  const [sedute, setSedute] = useState<any[] | null>(null);
  const [errore, setErrore] = useState('');
  useEffect(() => { api.get('/sedute').then(setSedute).catch((e) => setErrore(e.message)); }, []);

  return (
    <>
      <h2>Le tue sedute</h2>
      {utente.ruolo === 'admin' && <p><a href="#/amministrazione">Crea una seduta o gestisci gli organi collegiali</a></p>}
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      {sedute === null ? <p>Caricamento…</p> : sedute.length === 0 ? <p className="muto">Nessuna seduta convocata.</p> : (
        <ul className="griglia" style={{ listStyle: 'none', padding: 0 }}>
          {sedute.map((s) => (
            <li key={s.id} className="scheda">
              <span className={`etichetta ${STATO[s.stato]?.[1] ?? ''}`}>{STATO[s.stato]?.[0] ?? s.stato}</span>
              <h3 style={{ marginTop: 8 }}><a href={`#/sedute/${s.id}`}>{s.titolo}</a></h3>
              <div className="muto piccolo">{s.organo_nome}</div>
              <div className="piccolo">{fmtDataOra(s.data_ora)}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
