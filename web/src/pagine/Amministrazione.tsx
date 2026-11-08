import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';

export function Amministrazione() {
  const [organi, setOrgani] = useState<any[]>([]);
  const [tipi, setTipi] = useState<Record<string, string>>({});
  const [sel, setSel] = useState('');
  const [componenti, setComponenti] = useState<any[]>([]);
  const [errore, setErrore] = useState('');
  const [msg, setMsg] = useState('');

  const carica = async () => { setOrgani(await api.get('/organi')); };
  useEffect(() => { carica(); api.get('/tipi-organo').then(setTipi); }, []);
  useEffect(() => { if (sel) api.get(`/organi/${sel}/componenti`).then(setComponenti); else setComponenti([]); }, [sel]);

  const azione = async (f: () => Promise<any>, ok: (r: any) => string) => {
    setErrore(''); setMsg('');
    try { const r = await f(); setMsg(ok(r)); await carica(); if (sel) setComponenti(await api.get(`/organi/${sel}/componenti`)); return r; } catch (e: any) { setErrore(e.message); }
  };

  return (
    <>
      <h2>Amministrazione</h2>
      <div aria-live="polite">
        {errore && <div className="avviso errore" role="alert">{errore}</div>}
        {msg && <div className="avviso ok">{msg}</div>}
      </div>
      <div className="griglia">
        <NuovoOrgano tipi={tipi} onCrea={(nome, tipo) => azione(() => api.post('/organi', { nome, tipo }), () => `Organo «${nome}» creato`).then((r) => r && setSel(r.id))} />
        <section className="scheda" aria-labelledby="t-org">
          <h3 id="t-org">Organi collegiali</h3>
          <label htmlFor="sel-org">Organo</label>
          <select id="sel-org" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Seleziona…</option>
            {organi.map((o) => <option key={o.id} value={o.id}>{o.nome} ({o.n_componenti} componenti)</option>)}
          </select>
          {sel && <ImportaComponenti onImporta={(csv) => azione(() => api.post(`/organi/${sel}/importa`, { csv }), (r) => `Aggiunti ${r.aggiunti} componenti${r.errori.length ? `; righe scartate: ${r.errori.join('; ')}` : ''}`)} />}
        </section>
      </div>

      {sel && (
        <>
          <NuovaSeduta organoId={sel} componenti={componenti} onCrea={(b) => azione(() => api.post('/sedute', b), () => 'Seduta convocata').then((r) => { if (r) location.hash = `/sedute/${r.id}`; })} />
          <section className="scheda" aria-labelledby="t-comp">
            <h3 id="t-comp">Componenti ({componenti.length})</h3>
            <table>
              <thead><tr><th scope="col">Cognome e nome</th><th scope="col">Email</th><th scope="col"><span className="salta">Azioni</span></th></tr></thead>
              <tbody>{componenti.map((c) => (
                <tr key={c.id}><td>{c.cognome} {c.nome}</td><td>{c.email}</td>
                  <td><button className="link" onClick={() => azione(() => api.del(`/organi/${sel}/componenti/${c.id}`), () => 'Componente rimosso')}>Rimuovi <span className="salta">{c.cognome} {c.nome}</span></button></td></tr>
              ))}</tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

function NuovoOrgano({ tipi, onCrea }: { tipi: Record<string, string>; onCrea: (nome: string, tipo: string) => void }) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('collegio_docenti');
  return (
    <form className="scheda" onSubmit={(e) => { e.preventDefault(); onCrea(nome, tipo); setNome(''); }}>
      <h3>Nuovo organo collegiale</h3>
      <label htmlFor="tipo-org">Tipo</label>
      <select id="tipo-org" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(tipi).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label htmlFor="nome-org">Nome</label>
      <input id="nome-org" required placeholder="es. Consiglio di classe 3A" value={nome} onChange={(e) => setNome(e.target.value)} />
      <div className="riga-azioni"><button>Crea</button></div>
    </form>
  );
}

function ImportaComponenti({ onImporta }: { onImporta: (csv: string) => void }) {
  const [csv, setCsv] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onImporta(csv); setCsv(''); }}>
      <label htmlFor="csv">Aggiungi componenti</label>
      <textarea id="csv" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'email;nome;cognome\nmario.rossi@scuola.edu.it;Mario;Rossi'} aria-describedby="csv-aiuto" />
      <div id="csv-aiuto" className="aiuto">Una riga per persona: email;nome;cognome. Puoi incollare dal foglio di calcolo o caricare un file CSV.</div>
      <input type="file" accept=".csv,text/csv" aria-label="Carica file CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <div className="riga-azioni"><button disabled={!csv.trim()}>Importa</button></div>
    </form>
  );
}

function NuovaSeduta({ organoId, componenti, onCrea }: { organoId: string; componenti: any[]; onCrea: (b: any) => void }) {
  const [f, setF] = useState({ titolo: '', odg: '', dataOra: '', modalita: 'distanza', presidenteId: '', segretarioId: '', astenutiComputati: false });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const invia = (e: FormEvent) => { e.preventDefault(); onCrea({ ...f, organoId, dataOra: new Date(f.dataOra).toISOString() }); };
  return (
    <form className="scheda" onSubmit={invia}>
      <h3>Convoca una seduta</h3>
      <div className="griglia">
        <div><label htmlFor="s-tit">Titolo</label><input id="s-tit" required value={f.titolo} onChange={set('titolo')} /></div>
        <div><label htmlFor="s-data">Data e ora</label><input id="s-data" type="datetime-local" required value={f.dataOra} onChange={set('dataOra')} /></div>
        <div><label htmlFor="s-mod">Modalità</label>
          <select id="s-mod" value={f.modalita} onChange={set('modalita')}>
            <option value="distanza">A distanza</option><option value="mista">Mista</option><option value="presenza">In presenza con voto elettronico</option>
          </select></div>
        <div><label htmlFor="s-pres">Presidente</label>
          <select id="s-pres" required value={f.presidenteId} onChange={set('presidenteId')}><option value="">Seleziona…</option>{componenti.map((c) => <option key={c.id} value={c.id}>{c.cognome} {c.nome}</option>)}</select></div>
        <div><label htmlFor="s-segr">Segretario verbalizzante</label>
          <select id="s-segr" required value={f.segretarioId} onChange={set('segretarioId')}><option value="">Seleziona…</option>{componenti.map((c) => <option key={c.id} value={c.id}>{c.cognome} {c.nome}</option>)}</select></div>
      </div>
      <label htmlFor="s-odg">Ordine del giorno (un punto per riga)</label>
      <textarea id="s-odg" value={f.odg} onChange={set('odg')} />
      <label className="opzione"><input type="checkbox" checked={f.astenutiComputati} onChange={set('astenutiComputati')} /> Computa gli astenuti tra i voti validi (secondo il regolamento d'istituto)</label>
      <div className="riga-azioni"><button>Convoca</button></div>
    </form>
  );
}
