import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { RegistryService } from './service.ts';
import { TIPI_ORGANO } from './service.ts';

const TZ = 'Europe/Rome';
const fmtData = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric' });
const fmtOra = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDataOra = (iso: string) => `${fmtData(iso)} alle ore ${fmtOra(iso)}`;

/** I font standard PDF usano WinAnsi: sostituiamo i caratteri non rappresentabili. */
const winAnsi = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF€‘’“”–—…•\n]/g, '?');

class Writer {
  page!: PDFPage;
  y = 0;
  readonly margin = 56;
  readonly width = 595.28;
  readonly height = 841.89;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) { this.newPage(); }

  newPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  private wrap(text: string, font: PDFFont, size: number, maxW: number) {
    const out: string[] = [];
    for (const para of winAnsi(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const cand = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(cand, size) > maxW && line) { out.push(line); line = word; } else line = cand;
      }
      out.push(line);
    }
    return out;
  }

  text(t: string, o: { size?: number; bold?: boolean; indent?: number; gap?: number; color?: [number, number, number] } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const indent = o.indent ?? 0;
    for (const line of this.wrap(t, font, size, this.width - 2 * this.margin - indent)) {
      if (this.y < this.margin + size) this.newPage();
      this.page.drawText(line, { x: this.margin + indent, y: this.y - size, size, font, color: rgb(...(o.color ?? [0, 0, 0])) });
      this.y -= size * 1.35;
    }
    this.y -= o.gap ?? 2;
  }

  /** Due colonne affiancate (firme). */
  colonne(sx: string, dx: string, o: { size?: number; bold?: boolean } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    if (this.y < this.margin + size) this.newPage();
    const meta = (this.width - 2 * this.margin) / 2;
    this.page.drawText(winAnsi(sx), { x: this.margin, y: this.y - size, size, font });
    this.page.drawText(winAnsi(dx), { x: this.margin + meta, y: this.y - size, size, font });
    this.y -= size * 1.35 + 2;
  }

  heading(t: string) { this.y -= 6; this.text(t, { size: 12, bold: true, gap: 4 }); }
  space(n = 8) { this.y -= n; }
}

export async function generaVerbalePdf(svc: RegistryService, sedutaId: string): Promise<Uint8Array> {
  const s = svc.seduta(sedutaId);
  const componenti = svc.componentiSeduta(sedutaId);
  const eventi = svc.eventiPresenza(sedutaId);
  const votazioni = svc.votazioni(sedutaId);
  const nome = (id: string) => { const c = componenti.find((x) => x.id === id); return c ? `${c.cognome} ${c.nome}`.trim() : id; };

  const doc = await PDFDocument.create();
  doc.setTitle(`Verbale - ${s.titolo}`);
  doc.setSubject(`${s.organo_nome} - seduta del ${fmtData(s.data_ora)}`);
  doc.setProducer('Votazioni - piattaforma di voto per organi collegiali');
  doc.setLanguage('it-IT');
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text(`VERBALE DELLA SEDUTA - ${s.organo_nome.toUpperCase()}`, { size: 14, bold: true, gap: 4 });
  w.text(`${TIPI_ORGANO[s.organo_tipo] ?? s.organo_tipo} - ${s.titolo}`, { size: 11, gap: 10 });

  const modalita = { distanza: 'interamente a distanza', mista: 'in modalità mista (presenza e distanza)', presenza: 'in presenza con voto elettronico' }[s.modalita] ?? s.modalita;
  w.text(`Seduta convocata per il ${fmtDataOra(s.data_ora)}, svolta ${modalita} ai sensi del regolamento d'istituto e della nota MIM prot. n. 3803 del 30 giugno 2026.`);
  w.text(`Presiede: ${nome(s.presidente_id)}. Segretario verbalizzante: ${nome(s.segretario_id)}.`, { gap: 6 });

  if (s.odg.trim()) {
    w.heading('Ordine del giorno');
    for (const [i, punto] of s.odg.split('\n').map((x) => x.trim()).filter(Boolean).entries()) w.text(`${i + 1}. ${punto.replace(/^\d+[.)]\s*/, '')}`, { indent: 10 });
  }

  w.heading('Apertura e numero legale');
  if (s.aperta_il) {
    const entrateAllApertura = new Set(eventi.filter((e) => e.tipo === 'entrata' && e.ts <= s.aperta_il!).map((e) => e.utente_id));
    w.text(`La seduta è aperta il ${fmtDataOra(s.aperta_il)}. Componenti in carica: ${componenti.length}. Numero legale richiesto (metà più uno): ${Math.floor(componenti.length / 2) + 1}.`);
    if (entrateAllApertura.size) w.text(`Presenti all'apertura: ${entrateAllApertura.size}.`);
  }

  w.heading('Presenze');
  const partecipanti = new Map<string, Set<string>>();
  for (const e of eventi) if (e.tipo === 'entrata') (partecipanti.get(e.utente_id) ?? partecipanti.set(e.utente_id, new Set()).get(e.utente_id)!).add(e.modalita);
  const presentiL = componenti.filter((c) => partecipanti.has(c.id));
  const assentiL = componenti.filter((c) => !partecipanti.has(c.id));
  w.text(`Hanno partecipato (${presentiL.length}): ${presentiL.map((c) => `${c.cognome} ${c.nome} (${[...partecipanti.get(c.id)!].join('/')})`).join('; ') || 'nessuno'}.`);
  w.text(`Assenti (${assentiL.length}): ${assentiL.map((c) => `${c.cognome} ${c.nome}`).join('; ') || 'nessuno'}.`, { gap: 6 });
  w.text('Registro degli ingressi, delle uscite e delle disconnessioni:', { bold: true });
  for (const e of eventi) {
    w.text(`${fmtOra(e.ts)} - ${e.cognome} ${e.nome}: ${e.tipo}${e.modalita ? ` (${e.modalita})` : ''}${e.registrato_da === 'chiusura' ? ' alla chiusura della seduta' : e.registrato_da !== e.utente_id ? ' - registrata dalla presidenza' : ''}`, { size: 9, indent: 10, gap: 0 });
  }

  w.heading('Votazioni');
  if (!votazioni.length) w.text('Nessuna votazione.');
  for (const v of votazioni) {
    w.space(4);
    w.text(`Votazione n. ${v.numero} - ${v.oggetto}`, { bold: true, size: 11 });
    if (v.descrizione) w.text(v.descrizione, { indent: 10 });
    w.text(`Modalità: voto ${v.tipo}${v.tipo === 'segreta' ? ' (anonimato garantito da firma cieca e separazione tra Registro e Urna)' : ''}. Opzioni: ${v.opzioni.join(', ')}${v.maxScelte > 1 ? `; preferenze esprimibili: ${v.maxScelte}` : ''}.`, { indent: 10 });
    if (v.apertaIl) w.text(`Aperta alle ${fmtOra(v.apertaIl)} con ${v.presenti} presenti su ${v.componenti} componenti; aventi diritto al voto: ${v.aventiDiritto}.`, { indent: 10 });
    if (v.ripeteId) w.text('Ripetizione di una votazione precedentemente annullata.', { indent: 10 });
    if (v.stato === 'annullata') {
      w.text(`VOTAZIONE ANNULLATA. Motivo: ${v.motivoAnnullamento}.`, { indent: 10, bold: true });
      continue;
    }
    if (v.stato !== 'chiusa' || !v.esito) { w.text(`Stato: ${v.stato}.`, { indent: 10 }); continue; }
    const e = v.esito;
    w.text(`Chiusa alle ${fmtOra(v.chiusaIl!)}. Votanti: ${e.votanti}${v.tipo === 'segreta' ? `; schede bianche: ${e.bianche}` : ''}.`, { indent: 10 });
    w.text(`Risultati: ${Object.entries(e.counts).map(([k, n]) => `${k} ${n}`).join('; ')}.`, { indent: 10 });
    if (e.risultato) w.text(`Esito: ${e.risultato.toUpperCase()}. ${e.motivazione ?? ''}`, { indent: 10, bold: true });
    if (v.tipo === 'palese') {
      const voti = svc.votiPalesi(v.id);
      for (const o of v.opzioni) {
        const chi = voti.filter((x) => x.scelte.includes(o)).map((x) => `${x.cognome} ${x.nome}`);
        if (chi.length) w.text(`${o}: ${chi.join(', ')}.`, { indent: 20, size: 9 });
      }
    } else {
      w.text(`Impronta (SHA-256) dell'insieme delle schede: ${v.radice}`, { indent: 10, size: 8 });
      if (e.anomalia) w.text(`ANOMALIA: ${e.anomalia}`, { indent: 10, bold: true, color: [0.7, 0, 0] });
    }
  }

  w.heading('Chiusura');
  w.text(s.chiusa_il ? `Esauriti i punti all'ordine del giorno, la seduta è tolta il ${fmtDataOra(s.chiusa_il)}.` : 'Seduta non ancora chiusa: documento provvisorio.');

  w.heading('Integrità');
  const integ = svc.audit.verify();
  w.text(`Registro di audit: ${integ.ok ? 'catena di hash integra' : `catena INTERROTTA alla voce ${integ.brokenAt}`}. Impronta corrente: ${svc.audit.head()}.`, { size: 8 });
  w.text("L'impronta SHA-256 di questo file e la firma elettronica del sistema sono registrate dalla piattaforma e verificabili dalla pagina pubblica di verifica.", { size: 8 });

  w.space(30);
  w.colonne('Il Presidente', 'Il Segretario verbalizzante', { bold: true });
  w.colonne(nome(s.presidente_id), nome(s.segretario_id));
  w.space(24);
  w.colonne('______________________________', '______________________________');

  return doc.save({ useObjectStreams: false });
}
