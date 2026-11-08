import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtDataOra } from '../api.ts';

/** Pagina della commissione elettorale (amministrazione). */
export function Elezioni({ id }: { id?: string }) {
  return id ? <DettaglioElezione id={id} /> : <ElencoElezioni />;
}

function ElencoElezioni() {
  const [elenco, setElenco] = useState<any[]>([]);
  const [errore, setErrore] = useState('');
  const [f, setF] = useState({ titolo: 'Rappresentanti dei genitori nei consigli di classe', componente: 'genitori', apertura: '', chiusura: '' });
  useEffect(() => { api.get('/elezioni').then(setElenco).catch((e) => setErrore(e.message)); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const crea = async (e: FormEvent) => {
    e.preventDefault(); setErrore('');
    try {
      const r = await api.post('/elezioni', { ...f, apertura: new Date(f.apertura).toISOString(), chiusura: new Date(f.chiusura).toISOString() });
      location.hash = `/elezioni/${r.id}`;
    } catch (err: any) { setErrore(err.message); }
  };
  return (
    <>
      <h2>Elezioni dei rappresentanti</h2>
      <p className="muto">Consigli di classe, interclasse e intersezione con procedura semplificata (O.M. 215/1991, artt. 21-22): un seggio telematico per ogni classe, voto segreto, scrutinio automatico.</p>
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      <div className="griglia">
        <form className="scheda" onSubmit={crea}>
          <h3>Nuova elezione</h3>
          <label htmlFor="e-tit">Titolo</label><input id="e-tit" required value={f.titolo} onChange={set('titolo')} />
          <label htmlFor="e-comp">Componente</label>
          <select id="e-comp" value={f.componente} onChange={set('componente')}><option value="genitori">Genitori</option><option value="studenti">Studenti</option></select>
          <label htmlFor="e-ap">Apertura del seggio</label><input id="e-ap" type="datetime-local" required value={f.apertura} onChange={set('apertura')} />
          <label htmlFor="e-ch">Chiusura del seggio</label><input id="e-ch" type="datetime-local" required value={f.chiusura} onChange={set('chiusura')} />
          <div className="aiuto">Per i genitori le operazioni di voto devono durare almeno due ore (art. 22 c.3).</div>
          <div className="riga-azioni"><button>Crea</button></div>
        </form>
        <div className="scheda">
          <h3>Elezioni</h3>
          {elenco.length === 0 ? <p className="muto">Nessuna elezione.</p> : (
            <ul>{elenco.map((e) => <li key={e.id}><a href={`#/elezioni/${e.id}`}>{e.titolo}</a> <span className="piccolo muto">· {e.n_classi} classi · {e.stato}</span></li>)}</ul>
          )}
        </div>
      </div>
    </>
  );
}

function DettaglioElezione({ id }: { id: string }) {
  const [d, setD] = useState<any>(null);
  const [errore, setErrore] = useState('');
  const [msg, setMsg] = useState('');
  const [csv, setCsv] = useState('');
  const [posti, setPosti] = useState(1);
  const carica = useCallback(() => api.get(`/elezioni/${id}`).then(setD).catch((e) => setErrore(e.message)), [id]);
  useEffect(() => {
    carica();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica(); }, 5000);
    return () => clearInterval(t);
  }, [carica]);
  const azione = async (f: () => Promise<any>, ok: (r: any) => string) => {
    setErrore(''); setMsg('');
    try { const r = await f(); setMsg(ok(r)); await carica(); } catch (e: any) { setErrore(e.message); }
  };
  if (!d) return errore ? <div className="avviso errore" role="alert">{errore}</div> : <p>Caricamento…</p>;
  const totE = d.classi.reduce((a: number, c: any) => a + c.elettori, 0);
  const totV = d.classi.reduce((a: number, c: any) => a + c.votanti, 0);

  return (
    <>
      <p><a href="#/elezioni">← Elezioni</a></p>
      <h2>{d.titolo}</h2>
      <p className="muto">Rappresentanti dei {d.componente} · seggio dal {fmtDataOra(d.apertura)} al {fmtDataOra(d.chiusura)} · <span className="etichetta">{d.stato}</span></p>
      <div aria-live="polite">
        {errore && <div className="avviso errore" role="alert">{errore}</div>}
        {msg && <div className="avviso ok">{msg}</div>}
      </div>

      {d.stato === 'bozza' && (
        <form className="scheda" onSubmit={(e) => { e.preventDefault(); azione(() => api.post(`/elezioni/${id}/importa`, { csv, posti }), (r) => `Aggiunti ${r.aggiunti} elettori${r.errori.length ? `; righe scartate: ${r.errori.join('; ')}` : ''}`).then(() => setCsv('')); }}>
          <h3>Elettorato</h3>
          <label htmlFor="csv-el">Elenco elettori</label>
          <textarea id="csv-el" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'classe;email;nome;cognome\n1A;mario.rossi@email.it;Mario;Rossi'} aria-describedby="csv-el-aiuto" />
          <div id="csv-el-aiuto" className="aiuto">Una riga per elettore: classe;email;nome;cognome. Entrambi i genitori hanno diritto di voto; un genitore con più figli nella stessa classe vota una volta sola. Puoi esportare l'elenco dal registro elettronico.</div>
          <input type="file" accept=".csv,text/csv" aria-label="Carica file CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <label htmlFor="posti">Rappresentanti da eleggere per classe (per le nuove classi)</label>
          <input id="posti" type="number" min={1} max={20} value={posti} onChange={(e) => setPosti(Number(e.target.value))} />
          <div className="aiuto">Genitori: 1 per classe o sezione in infanzia e primaria, 4 nella secondaria di I grado, 2 nella secondaria di II grado. Studenti: 2 nella secondaria di II grado (O.M. 215/1991, art. 6).</div>
          <div className="riga-azioni"><button disabled={!csv.trim()}>Importa</button></div>
        </form>
      )}

      <section className="scheda" aria-labelledby="t-classi">
        <h3 id="t-classi">Classi ({d.classi.length})</h3>
        {d.stato !== 'bozza' && <p aria-live="polite">Affluenza complessiva: {totV} su {totE} ({totE ? Math.round((totV / totE) * 100) : 0}%)</p>}
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th scope="col">Classe</th><th scope="col">Elettori</th><th scope="col">Posti</th><th scope="col">Preferenze</th><th scope="col">Votanti</th><th scope="col">Eletti</th></tr></thead>
            <tbody>{d.classi.map((c: any) => <RigaClasse key={c.id} c={c} modificabile={d.stato === 'bozza'} azione={azione} />)}</tbody>
          </table>
        </div>
      </section>

      <div className="riga-azioni">
        {d.stato === 'bozza' && d.classi.length > 0 && <button onClick={() => azione(() => api.post(`/elezioni/${id}/apri`), () => 'Seggi aperti: gli elettori vedono la scheda dopo l\'accesso')}>Apri i seggi</button>}
        {d.stato === 'aperta' && <button className="pericolo" onClick={() => azione(() => api.post(`/elezioni/${id}/chiudi`), () => 'Seggi chiusi e scrutinio completato')}>Chiudi i seggi e scrutina</button>}
        {d.stato !== 'bozza' && <a className="bottone secondario" style={{ background: '#fff', color: 'var(--blu)' }} href={`/api/elezioni/${id}/verbale.pdf`}>{d.stato === 'chiusa' ? 'Scarica il verbale firmato' : 'Anteprima verbale'}</a>}
      </div>
    </>
  );
}

function RigaClasse({ c, modificabile, azione }: { c: any; modificabile: boolean; azione: (f: () => Promise<any>, ok: (r: any) => string) => void }) {
  const [posti, setPosti] = useState(c.posti);
  const [pref, setPref] = useState(c.preferenze);
  const salva = () => azione(() => api.post(`/elezioni/classi/${c.id}`, { posti, preferenze: pref }), () => `Classe ${c.classe} aggiornata`);
  return (
    <tr>
      <th scope="row">{c.classe}</th>
      <td>{c.elettori}</td>
      <td>{modificabile ? <input aria-label={`Posti classe ${c.classe}`} type="number" min={1} max={20} value={posti} style={{ width: 80 }} onChange={(e) => { const p = Number(e.target.value); setPosti(p); setPref(Math.max(1, Math.floor(p / 2))); }} onBlur={salva} /> : c.posti}</td>
      <td>{modificabile ? <input aria-label={`Preferenze classe ${c.classe}`} type="number" min={1} max={posti} value={pref} style={{ width: 80 }} onChange={(e) => setPref(Number(e.target.value))} onBlur={salva} /> : c.preferenze}</td>
      <td>{c.esito ? c.esito.votanti : c.votanti}{c.esito ? ` (bianche ${c.esito.bianche})` : ''}</td>
      <td>
        {c.esito ? (c.esito.eletti.length ? c.esito.eletti.map((e: any) => `${e.etichetta} (${e.voti}${e.perSorteggio ? ', sorteggio' : ''})`).join(', ') : 'nessuno') : '–'}
        {c.esito?.anomalia && <div className="avviso errore">{c.esito.anomalia}</div>}
      </td>
    </tr>
  );
}
