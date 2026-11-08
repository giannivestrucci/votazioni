# Conformità all'Allegato tecnico della nota MIM prot. 3803 del 30/06/2026

Questa tabella collega ogni requisito dell'Allegato tecnico ("Requisiti tecnico-organizzativi per la gestione digitale degli organi collegiali e delle operazioni di voto nelle istituzioni scolastiche") a come lo soddisfa la piattaforma. È la base per la **dichiarazione di conformità del fornitore** richiesta dal §9.

Legenda: ✅ implementato · 🟡 parziale o dipende dalla configurazione · 🏫 adempimento della scuola · ⏳ fase successiva

| # | Requisito (sezione) | Stato | Come |
|---|---|---|---|
| 1 | Identificazione certa, azioni riconducibili all'utente (§2) | ✅ | Accesso personale con codice monouso sulla casella istituzionale; ogni azione è nel registro di audit con l'identità dell'autore. Fa eccezione il voto segreto, come previsto. |
| 2 | Validità giuridica (§2) | 🟡🏫 | Numero legale verificato all'apertura di ogni votazione deliberativa; maggioranza secondo art. 37 D.Lgs. 297/1994. Il regolamento d'istituto va adeguato. |
| 3 | Integrità e sicurezza di dati e risultati (§2) | ✅ | Voti palesi protetti da trigger contro le modifiche; schede segrete con firma verificata; registro di audit append-only a catena di hash. |
| 4 | Verificabilità ex post (§2) | ✅ | Registro di audit consultabile da presidente e segretario; bacheca pubblica delle ricevute; impronta delle schede nel verbale. |
| 5 | Anonimato effettivo, non reversibile, dimostrabile (§2) | ✅ | Firme cieche RSA (RFC 9474) e separazione Registro/Urna, descritte in [architettura.md](architettura.md) e coperte dai test automatici. |
| 6 | Identità univoche e non condivise (§3.1) | ✅ | Un account per email istituzionale; elettorato preso dall'elenco dei componenti dell'organo. |
| 7 | Autenticazione adeguata al rischio, preferibilmente forte (§3.2) | 🟡⏳ | Oggi: codice monouso di 6 cifre (scadenza 10 minuti, massimo 5 tentativi). In arrivo: accesso con Google Workspace o Microsoft 365 della scuola, passkey, SPID/CIE. |
| 8 | Ruoli distinti e privilegi minimi (§3.3) | ✅ | Amministrazione (dirigenza o segreteria), presidente, segretario, componente. Le operazioni di seduta sono riservate alla presidenza. |
| 9 | Gestione sessioni (§3.4) | ✅ | Una sola sessione attiva per utente (un nuovo accesso chiude le precedenti); scadenza dopo 30 minuti di inattività e comunque dopo 8 ore; token conservato solo come hash. |
| 10 | Un voto per avente diritto, immodificabile, quorum (§4.1) | ✅ | Chiave primaria (votazione, utente) per voti palesi e gettoni; aventi diritto fissati all'apertura; numero legale obbligatorio. |
| 11 | Sondaggi in videoconferenza (§4.1) | ✅ | Non usati: il voto avviene sulla piattaforma. La videoconferenza resta lo strumento scelto dalla scuola. |
| 12 | Voto palese tracciato (§4.2) | ✅ | Nominativi e scelte riportati nel verbale. |
| 13 | Voto segreto: separazione autenticazione/voto, nessun accesso degli amministratori, log senza re-identificazione (§4.3) | ✅ | L'Urna non riceve cookie, IP né user agent nei log, non salva orari e non conserva l'ordine delle schede (tabella WITHOUT ROWID con chiave casuale). Il Registro sa solo che il gettone è stato ritirato. La chiave di firma viene distrutta alla chiusura. |
| 14 | Sicurezza ICT AgID (§5) | 🟡🏫 | Header di sicurezza (CSP, no-frame), validazione degli input, cookie HttpOnly e SameSite=Strict. In produzione: TLS, hosting qualificato e aggiornamenti periodici. |
| 15 | Backup e ripristino (§5) | 🏫⏳ | Database SQLite in file: da includere nel backup del server. Sono previste procedure documentate. |
| 16 | Cloud: localizzazione UE (§5) | 🏫 | Da scegliere in fase di installazione (hosting nell'UE). |
| 17 | Principi GDPR (§6) | ✅ | Dati minimi (nome, cognome, email); nessun dato di voto segreto collegabile alla persona. |
| 18 | Responsabile del trattamento ex art. 28 (§6) | 🏫⏳ | Modello di nomina da fornire con la piattaforma. |
| 19 | Cifratura, pseudonimizzazione, controllo accessi (§6) | 🟡 | Anonimizzazione strutturale del voto segreto; controllo accessi per ruolo. La cifratura a riposo dipende dall'hosting (disco cifrato). |
| 20 | DPIA (§6) | 🏫⏳ | Bozza di DPIA da fornire con la piattaforma. |
| 21 | Verbali immodificabili con metadati (§7) | ✅ | PDF generato una sola volta a seduta chiusa, con impronta SHA-256 e firma Ed25519 del sistema, verificabile pubblicamente. Spazio per la firma di presidente e segretario. |
| 22 | Conservazione secondo le Linee guida AgID (§7) | 🟡⏳ | Oggi PDF standard. In arrivo: PDF/A ed esportazione verso il sistema di conservazione della scuola. |
| 23 | Regolamento d'istituto (§8) | 🏫 | Adempimento della scuola. È prevista una bozza di regolamento. |
| 24 | Presidente e segretario (§8) | ✅ | Obbligatori alla convocazione e riportati nel verbale. |
| 25 | Malfunzionamenti: sospensione e ripetizione (§8) | ✅ | "Annulla per malfunzionamento" con motivo obbligatorio; ripetizione automatica; tutto riportato nel verbale. |
| 26 | Verifica preventiva e dichiarazione del fornitore (§9) | 🏫⏳ | Questo documento e i test automatici sono la base della dichiarazione. |

## Requisiti aggiuntivi adottati

- **Seduta mista**: presenze "in aula" e "da remoto" registrate distintamente; la presidenza può registrare ingressi e uscite di chi è in aula.
- **Registro di ingressi, uscite e disconnessioni** nel verbale, come chiesto nelle interpretazioni sindacali (FeNSIR).
- **Numero legale** verificato all'apertura di ogni votazione deliberativa, non solo della seduta.
- **Astenuti**: il computo tra i voti validi è configurabile per seduta, secondo il regolamento d'istituto.
- **Accessibilità** (L. 4/2004, WCAG 2.1 AA): HTML semantico, etichette sui campi, focus visibile, aree di stato annunciate dagli screen reader, controlli di almeno 44 px. Manca ancora un audit formale.

## Cosa NON copre la nota 3803

La nota riguarda le sedute deliberative (Collegio docenti, consigli di classe, interclasse e intersezione, GLO). Le **elezioni dei rappresentanti** di genitori e studenti restano regolate dall'O.M. 215/1991: saranno un modulo separato, in una fase successiva.
