# Votazioni

Piattaforma di voto online per le scuole. Le **sedute degli organi collegiali** (collegio dei docenti, consigli di classe, interclasse e intersezione, GLO) seguono l'**Allegato tecnico alla nota MIM prot. n. 3803 del 30 giugno 2026**. Le **elezioni dei rappresentanti** di genitori e studenti nei consigli di classe seguono l'O.M. 215/1991.

![Scheda di voto segreto](docs/img/scheda-voto.png)

## Cosa fa (fase 1: sedute collegiali)

- **Accesso senza password** con codice monouso inviato alla casella istituzionale. Una sola sessione attiva per persona, con scadenza per inattività.
- **Organi collegiali e componenti**, importabili da CSV (`email;nome;cognome`).
- **Convocazione delle sedute**: a distanza, mista o in presenza con voto elettronico, con presidente, segretario e ordine del giorno.
- **Presenze e numero legale** in tempo reale, con registro degli ingressi, delle uscite e delle disconnessioni.
- **Voto palese** nominativo e **voto segreto** anonimo, basato su firme cieche (RFC 9474) e sulla separazione tra Registro e Urna. È possibile anche votare tra candidati, con più preferenze.
- **Esito automatico** secondo l'art. 37 D.Lgs. 297/1994: maggioranza assoluta dei voti validi; in caso di parità prevale il presidente nel voto palese.
- **Annullamento per malfunzionamento** con motivazione e ripetizione della votazione.
- **Verbale PDF** generato a fine seduta, immodificabile, firmato dal sistema e verificabile da chiunque nella pagina "Verifica verbale".
- **Registro di audit** append-only a catena di hash.

## Elezioni dei rappresentanti (fase 2)

- **Procedura semplificata** (O.M. 215/1991, artt. 21-22) con un seggio telematico per ogni classe.
- **Elettorato** importato da CSV (`classe;email;nome;cognome`). Entrambi i genitori votano; chi ha più figli nella stessa classe vota una volta sola, chi ha figli in classi diverse vota in ciascuna.
- **Lista unica** con tutti gli elettori della classe in ordine alfabetico (art. 22 c.7). Le preferenze sono pari alla metà dei posti, almeno una, e si possono modificare classe per classe.
- **Voto segreto** con le stesse firme cieche delle sedute. La finestra oraria del seggio è applicata dal server e la scheda bianca è ammessa.
- **Scrutinio automatico** con proclamazione degli eletti e **sorteggio** in caso di parità (art. 22 c.8). Il sorteggio è registrato nel verbale e nell'audit.
- **Verbale delle operazioni elettorali** in PDF firmato, verificabile come quello delle sedute.

![Scheda elettorale su telefono](docs/img/scheda-elettorale.png)

Dettagli: [architettura](docs/architettura.md) · [tabella di conformità all'Allegato tecnico](docs/conformita.md)

## Avvio rapido (sviluppo)

Richiede Node.js 22.13 o successivo.

```bash
npm install
npx vite build                 # interfaccia web in web/dist
npm run seed                   # dati dimostrativi in ./data
DEV_OTP=1 npm start            # http://localhost:3000
```

I dati dimostrativi comprendono anche un'elezione già aperta: accedi come `lucia.ferrari@famiglia.it`, genitore nelle classi 1A e 2B.

Con `DEV_OTP=1` il codice di accesso compare a schermo invece di essere inviato via email. Accedi come `dirigente@scuola.edu.it` (amministrazione e presidenza) oppure come uno dei docenti dimostrativi (`marco.bianchi@scuola.edu.it`, `sara.ricci@scuola.edu.it`, …).

Per sviluppare l'interfaccia con ricarica automatica: `npm run dev` in un terminale e `npm run dev:web` in un altro (http://localhost:5173).

```bash
npm test          # test di integrazione (voto palese, voto segreto, quorum, verbale, audit)
npm run typecheck
```

## Pubblicazione online

Per installare la piattaforma su un server con HTTPS (ad esempio un VPS Aruba Cloud) segui la [guida alla pubblicazione](docs/pubblicazione.md). Il pacchetto comprende `Dockerfile`, configurazione Docker Compose con HTTPS automatico (Caddy), script di installazione e di backup in `deploy/`.

## Configurazione

| Variabile | Significato |
|---|---|
| `SERVICE` | `all` (predefinito), `registry` oppure `urna`. In produzione è consigliato separare Registro e Urna. |
| `DATA_DIR` | Cartella dei database (`registro.db`, `urna.db`) |
| `PORT`, `HOST` | Indirizzo di ascolto |
| `URNA_URL`, `URNA_TOKEN` | Con `SERVICE=registry`: indirizzo dell'Urna e segreto condiviso per le chiamate interne |
| `ADMIN_EMAIL`, `ADMIN_NOME`, `ADMIN_COGNOME` | Primo amministratore, creato all'avvio se non esiste |
| `SMTP_URL`, `SMTP_FROM` | Invio dei codici di accesso via email, ad esempio `smtps://utente:password@smtp.esempio.it:465` e `"Votazioni <noreply@scuola.edu.it>"`. Obbligatori in produzione; senza, in sviluppo i codici compaiono nella console. |
| `DEV_OTP=1` | Mostra il codice di accesso a schermo (vietato con `NODE_ENV=production`) |

## Stato e prossimi passi

- [x] Fase 1: sedute collegiali con voto palese e segreto, verbale, audit
- [x] Invio email via SMTP
- [x] Fase 2: elezioni dei rappresentanti di genitori e studenti nei consigli di classe (O.M. 215/1991)
- [ ] Accesso con Google Workspace, Microsoft 365, SPID o CIE
- [ ] Consiglio d'istituto con liste e metodo D'Hondt (art. 44 O.M. 215/1991)
- [ ] Verbale in PDF/A ed esportazione verso la conservazione; modelli di DPIA, nomina ex art. 28 e regolamento d'istituto
- [ ] Audit di accessibilità WCAG 2.1 AA
