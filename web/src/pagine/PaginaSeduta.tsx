import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtDataOra, fmtOra, trasporto, type Seduta, type Utente, type Votazione } from '../api.ts';
import { deposita, DepositoError, votaSegreto, type SchedaPendente } from '../votoSegreto.ts';

const MODALITA = { distanza: 'A distanza', mista: 'Mista (presenza e distanza)', presenza: 'In presenza con voto elettronico' };

export function PaginaSeduta({ id }: { id: string; utente: Utente }) {
  const [s, setS] = useState<Seduta | null>(null);
  const [errore, setErrore] = useState('');
  const [msg, setMsg] = useState('');

  const carica = useCallback(() => api.get<Seduta>(`/sedute/${id}`).then(setS).catch((e) => setErrore(e.message)), [id]);
  useEffect(() => {
    carica();
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica(); }, 3000);
    return () => clearInterval(t);
  }, [carica]);

  const azione = async (f: () => Promise<unknown>, ok?: string) => {
    setErrore(''); setMsg('');
    try { await f(); if (ok) setMsg(ok); await carica(); } catch (e: any) { setErrore(e.message); }
  };

  if (!s) return errore ? <div className="avviso errore" role="alert">{errore}</div> : <p>Caricamento…</p>;
  const aperta = s.votazioni.find((v) => v.stato === 'aperta');

  return (
    <>
      <p><a href="#/">← Tutte le sedute</a></p>
      <h2>{s.titolo}</h2>
      <p className="muto">{s.organo.nome} · {fmtDataOra(s.dataOra)} · {MODALITA[s.modalita]}</p>
      <p className="piccolo">Presidente: {s.presidente.nome} · Segretario: {s.segretario.nome}</p>

      <div aria-live="polite">
        {errore && <div className="avviso errore" role="alert">{errore}</div>}
        {msg && <div className="avviso ok">{msg}</div>}
      </div>

      <div className="griglia">
        <section className="scheda" aria-labelledby="t-stato">
          <h3 id="t-stato">Stato della seduta</h3>
          <p>
            <span className={`etichetta ${s.stato === 'aperta' ? 'verde' : s.stato === 'chiusa' ? 'ambra' : ''}`}>
              {s.stato === 'programmata' ? 'Non ancora aperta' : s.stato === 'aperta' ? `Aperta alle ${fmtOra(s.apertaIl!)}` : `Chiusa alle ${fmtOra(s.chiusaIl!)}`}
            </span>
          </p>
          <p>
            Presenti <strong>{s.quorum.presenti}</strong> su {s.quorum.componenti} · numero legale {s.quorum.richiesto}{' '}
            <span className={`etichetta ${s.quorum.ok ? 'verde' : 'rosso'}`}>{s.quorum.ok ? 'raggiunto' : 'non raggiunto'}</span>
          </p>
          {s.stato === 'aperta' && (
            <div className="riga-azioni">
              {s.io.presente
                ? <><span>Sei presente ({s.io.presente}).</span><button className="secondario" onClick={() => azione(() => api.post(`/sedute/${id}/presenze`, { tipo: 'uscita' }), 'Uscita registrata')}>Registra uscita</button></>
                : <>
                    {s.modalita !== 'presenza' && <button onClick={() => azione(() => api.post(`/sedute/${id}/presenze`, { tipo: 'entrata', modalita: 'remoto' }), 'Presenza registrata')}>Partecipo da remoto</button>}
                    {s.modalita !== 'distanza' && <button className={s.modalita === 'presenza' ? '' : 'secondario'} onClick={() => azione(() => api.post(`/sedute/${id}/presenze`, { tipo: 'entrata', modalita: 'presenza' }), 'Presenza registrata')}>Sono in aula</button>}
                  </>}
            </div>
          )}
        </section>

        {s.odg && (
          <section className="scheda" aria-labelledby="t-odg">
            <h3 id="t-odg">Ordine del giorno</h3>
            <ol>{s.odg.split('\n').filter((x) => x.trim()).map((p, i) => <li key={i}>{p.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>
          </section>
        )}
      </div>

      {aperta && <SchedaVoto key={aperta.id} v={aperta} onVotato={carica} />}

      {s.io.presidenza && <Presidenza s={s} azione={azione} />}

      <section aria-labelledby="t-vot">
        <h3 id="t-vot" style={{ marginTop: 16 }}>Votazioni</h3>
        {s.votazioni.length === 0 && <p className="muto">Nessuna votazione.</p>}
        {s.votazioni.map((v) => <RiepilogoVotazione key={v.id} v={v} s={s} azione={azione} />)}
      </section>
    </>
  );
}

function SchedaVoto({ v, onVotato }: { v: Votazione; onVotato: () => void }) {
  const [scelte, setScelte] = useState<string[]>([]);
  const [errore, setErrore] = useState('');
  const [ricevuta, setRicevuta] = useState('');
  const [invio, setInvio] = useState(false);
  const [pendente, setPendente] = useState<SchedaPendente | null>(null);
  const multipla = v.maxScelte > 1;

  if (!v.possoVotare) return <div className="avviso attenzione">È aperta la votazione n. {v.numero}: non risulti tra gli aventi diritto perché non eri presente all'apertura.</div>;
  if (ricevuta) return (
    <div className="avviso ok" role="status">
      <strong>Voto registrato.</strong> Conserva la ricevuta: a votazione chiusa potrai ritrovarla nella bacheca pubblica delle schede.
      <div className="ricevuta">{ricevuta}</div>
    </div>
  );
  if (v.hoVotato && !pendente) return <div className="avviso ok">Hai già votato nella votazione n. {v.numero}.</div>;

  const invia = async (e: FormEvent) => {
    e.preventDefault(); setErrore('');
    if (v.tipo === 'palese' && scelte.length === 0) { setErrore('Seleziona un\'opzione'); return; }
    setInvio(true);
    try {
      if (pendente) setRicevuta(await deposita(trasporto, pendente));
      else if (v.tipo === 'segreta') setRicevuta(await votaSegreto(trasporto, v.id, scelte));
      else { await api.post(`/votazioni/${v.id}/voto`, { scelte }); setRicevuta('Voto palese: il tuo nome e la tua scelta compariranno nel verbale.'); }
      setPendente(null);
      onVotato();
    } catch (err: any) {
      if (err instanceof DepositoError) { setPendente(err.pendente); setErrore('Il voto non è ancora stato depositato per un problema di rete. Premi "Riprova invio": il tuo gettone è conservato.'); }
      else setErrore(err.message);
    } finally { setInvio(false); }
  };

  return (
    <form className="scheda" style={{ borderColor: 'var(--blu)', borderWidth: 2 }} onSubmit={invia} aria-labelledby={`vt-${v.id}`}>
      <h3 id={`vt-${v.id}`}>Votazione n. {v.numero}: {v.oggetto}</h3>
      {v.descrizione && <p>{v.descrizione}</p>}
      <p><span className="etichetta">{v.tipo === 'segreta' ? 'Voto segreto' : 'Voto palese'}</span>{' '}
        <span className="piccolo muto">{v.tipo === 'segreta' ? 'Nessuno, nemmeno gli amministratori, può collegare il tuo nome alla tua scelta.' : 'Il tuo nome e la tua scelta saranno riportati nel verbale.'}</span></p>
      <fieldset disabled={!!pendente}>
        <legend>{multipla ? `Scegli fino a ${v.maxScelte} opzioni` : 'Scegli un\'opzione'}</legend>
        {v.opzioni.map((o) => (
          <label key={o} className="opzione">
            <input type={multipla ? 'checkbox' : 'radio'} name={`o-${v.id}`} value={o} checked={scelte.includes(o)}
              onChange={(e) => setScelte(multipla ? (e.target.checked ? [...scelte, o].slice(0, v.maxScelte) : scelte.filter((x) => x !== o)) : [o])} />
            {o}
          </label>
        ))}
      </fieldset>
      {errore && <div className="avviso errore" role="alert">{errore}</div>}
      <div className="riga-azioni">
        <button disabled={invio}>{pendente ? 'Riprova invio' : invio ? 'Invio in corso…' : v.tipo === 'segreta' && scelte.length === 0 ? 'Vota scheda bianca' : 'Conferma il voto'}</button>
        <span className="piccolo muto">Il voto non può essere modificato dopo la conferma.</span>
      </div>
    </form>
  );
}

function RiepilogoVotazione({ v, s, azione }: { v: Votazione; s: Seduta; azione: (f: () => Promise<unknown>, ok?: string) => void }) {
  const [annulla, setAnnulla] = useState(false);
  const [motivo, setMotivo] = useState('');
  const stato = { bozza: ['Da aprire', ''], aperta: ['In corso', 'verde'], chiusa: ['Chiusa', 'ambra'], annullata: ['Annullata', 'rosso'] }[v.stato];
  const tot = v.esito ? Object.values(v.esito.counts).reduce((a, b) => a + b, 0) || 1 : 1;

  return (
    <article className="scheda">
      <h4 style={{ margin: 0 }}>n. {v.numero} · {v.oggetto} <span className={`etichetta ${stato[1]}`}>{stato[0]}</span> <span className="etichetta">{v.tipo}</span></h4>
      {v.ripeteId && <p className="piccolo muto">Ripetizione di una votazione annullata.</p>}
      {v.stato === 'aperta' && v.affluenza && (
        <p aria-live="polite">Hanno votato {v.affluenza.votanti} su {v.affluenza.aventi} aventi diritto.</p>
      )}
      {v.stato === 'annullata' && <p>Motivo: {v.motivoAnnullamento}</p>}
      {v.esito && (
        <>
          {v.esito.risultato && <p><strong className={v.esito.risultato === 'approvata' ? '' : ''}>
            <span className={`etichetta ${v.esito.risultato === 'approvata' ? 'verde' : 'rosso'}`}>{v.esito.risultato.toUpperCase()}</span></strong> <span className="piccolo">{v.esito.motivazione}</span></p>}
          <table>
            <caption className="piccolo muto" style={{ textAlign: 'left' }}>Votanti {v.esito.votanti}{v.tipo === 'segreta' ? `, schede bianche ${v.esito.bianche}` : ''}</caption>
            <thead><tr><th scope="col">Opzione</th><th scope="col">Voti</th><th scope="col" style={{ width: '40%' }}><span className="salta">Grafico</span></th></tr></thead>
            <tbody>
              {Object.entries(v.esito.counts).map(([k, n]) => (
                <tr key={k}><td>{k}</td><td>{n}</td><td><div className="barra" aria-hidden="true"><span style={{ width: `${(n / tot) * 100}%` }} /></div></td></tr>
              ))}
            </tbody>
          </table>
          {v.esito.anomalia && <div className="avviso errore">{v.esito.anomalia}</div>}
          {v.tipo === 'segreta' && v.radice && <p className="piccolo">Impronta delle schede: <span className="ricevuta">{v.radice}</span> · <a href={`/urna/urne/${v.id}/bacheca`} target="_blank" rel="noreferrer">bacheca pubblica delle ricevute</a></p>}
          {v.votiPalesi && v.votiPalesi.length > 0 && (
            <details><summary>Voti nominativi</summary>
              <ul>{v.votiPalesi.map((x, i) => <li key={i}>{x.cognome} {x.nome}: {x.scelte.join(', ')}</li>)}</ul>
            </details>
          )}
        </>
      )}
      {s.io.presidenza && s.stato === 'aperta' && (
        <div className="riga-azioni">
          {v.stato === 'bozza' && <button onClick={() => azione(() => api.post(`/votazioni/${v.id}/apri`), `Votazione n. ${v.numero} aperta`)}>Apri la votazione</button>}
          {v.stato === 'aperta' && <button onClick={() => azione(() => api.post(`/votazioni/${v.id}/chiudi`), `Votazione n. ${v.numero} chiusa`)}>Chiudi e scrutina</button>}
          {(v.stato === 'aperta' || v.stato === 'chiusa') && !annulla && <button className="secondario" onClick={() => setAnnulla(true)}>Annulla per malfunzionamento</button>}
        </div>
      )}
      {annulla && (
        <form onSubmit={(e) => { e.preventDefault(); azione(() => api.post(`/votazioni/${v.id}/annulla`, { motivo, ripeti: true }), 'Votazione annullata: è stata creata la ripetizione'); setAnnulla(false); }}>
          <label htmlFor={`m-${v.id}`}>Motivo dell'annullamento (sarà riportato nel verbale)</label>
          <textarea id={`m-${v.id}`} required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="riga-azioni"><button className="pericolo">Annulla e ripeti</button><button type="button" className="secondario" onClick={() => setAnnulla(false)}>Indietro</button></div>
        </form>
      )}
    </article>
  );
}

function Presidenza({ s, azione }: { s: Seduta; azione: (f: () => Promise<unknown>, ok?: string) => void }) {
  const [oggetto, setOggetto] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [tipo, setTipo] = useState<'palese' | 'segreta'>('palese');
  const [personalizzate, setPersonalizzate] = useState(false);
  const [opzioni, setOpzioni] = useState('');
  const [maxScelte, setMaxScelte] = useState(1);
  const [utentePres, setUtentePres] = useState('');

  const crea = (e: FormEvent) => {
    e.preventDefault();
    const body: any = { oggetto, descrizione, tipo };
    if (personalizzate) { body.opzioni = opzioni.split('\n').map((x) => x.trim()).filter(Boolean); body.maxScelte = maxScelte; }
    azione(() => api.post(`/sedute/${s.id}/votazioni`, body), 'Votazione creata');
    setOggetto(''); setDescrizione(''); setOpzioni(''); setTipo('palese'); setPersonalizzate(false); setMaxScelte(1);
  };

  return (
    <section className="scheda" aria-labelledby="t-pres" style={{ background: '#fbfcfd' }}>
      <h3 id="t-pres">Presidenza</h3>
      <div className="riga-azioni">
        {s.stato === 'programmata' && <button onClick={() => azione(() => api.post(`/sedute/${s.id}/apri`), 'Seduta aperta')}>Apri la seduta</button>}
        {s.stato === 'aperta' && <button className="pericolo" onClick={() => azione(() => api.post(`/sedute/${s.id}/chiudi`), 'Seduta chiusa')}>Chiudi la seduta</button>}
        <a className="bottone secondario" style={{ background: '#fff', color: 'var(--blu)' }} href={`/api/sedute/${s.id}/verbale.pdf`}>{s.stato === 'chiusa' ? 'Scarica il verbale firmato' : 'Anteprima verbale'}</a>
      </div>

      {s.stato === 'aperta' && (
        <>
          <details style={{ marginTop: 12 }}>
            <summary>Presenti ({s.presenti.length}) e registrazione presenze in aula</summary>
            <ul>{s.presenti.map((p) => <li key={p.id}>{p.cognome} {p.nome} · {p.modalita} <button className="link" onClick={() => azione(() => api.post(`/sedute/${s.id}/presenze`, { utenteId: p.id, tipo: 'uscita' }))}>registra uscita</button></li>)}</ul>
            {s.componenti && (
              <form onSubmit={(e) => { e.preventDefault(); if (utentePres) azione(() => api.post(`/sedute/${s.id}/presenze`, { utenteId: utentePres, tipo: 'entrata', modalita: s.modalita === 'distanza' ? 'remoto' : 'presenza' })); }}>
                <label htmlFor="up">Registra l'ingresso di un componente</label>
                <select id="up" value={utentePres} onChange={(e) => setUtentePres(e.target.value)}>
                  <option value="">Seleziona…</option>
                  {s.componenti.filter((c) => !s.presenti.some((p) => p.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.cognome} {c.nome}</option>)}
                </select>
                <div className="riga-azioni"><button className="secondario">Registra ingresso</button></div>
              </form>
            )}
          </details>

          <form onSubmit={crea} style={{ marginTop: 12 }}>
            <h4 style={{ marginBottom: 0 }}>Nuova votazione</h4>
            <label htmlFor="ogg">Oggetto</label>
            <input id="ogg" required value={oggetto} onChange={(e) => setOggetto(e.target.value)} />
            <label htmlFor="desc">Testo della proposta (facoltativo)</label>
            <textarea id="desc" value={descrizione} onChange={(e) => setDescrizione(e.target.value)} />
            <fieldset>
              <legend>Tipo di voto</legend>
              <label className="opzione"><input type="radio" name="tipo" checked={tipo === 'palese'} onChange={() => setTipo('palese')} /> Palese (nominativo)</label>
              <label className="opzione"><input type="radio" name="tipo" checked={tipo === 'segreta'} onChange={() => setTipo('segreta')} /> Segreto (obbligatorio quando si tratta di persone)</label>
            </fieldset>
            <label className="opzione"><input type="checkbox" checked={personalizzate} onChange={(e) => setPersonalizzate(e.target.checked)} /> Opzioni diverse da Favorevole / Contrario / Astenuto (es. candidati)</label>
            {personalizzate && (
              <>
                <label htmlFor="opz">Opzioni, una per riga</label>
                <textarea id="opz" required value={opzioni} onChange={(e) => setOpzioni(e.target.value)} />
                <label htmlFor="max">Preferenze esprimibili</label>
                <input id="max" type="number" min={1} value={maxScelte} onChange={(e) => setMaxScelte(Number(e.target.value))} />
              </>
            )}
            <div className="riga-azioni"><button>Crea votazione</button></div>
          </form>
        </>
      )}
    </section>
  );
}
