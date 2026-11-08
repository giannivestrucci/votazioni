# Votazioni

Piattaforma di voto online per gli organi collegiali delle scuole: collegio dei docenti, consigli di classe, interclasse e intersezione, GLO. È progettata sui requisiti dell'**Allegato tecnico alla nota MIM prot. n. 3803 del 30 giugno 2026**. Un modulo per le elezioni dei rappresentanti (O.M. 215/1991) è previsto in una fase successiva.

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

Dettagli: [architettura](docs/architettura.md) · [tabella di conformità all'Allegato tecnico](docs/conformita.md)

## Avvio rapido (sviluppo)

Richiede Node.js 22.13 o successivo.

```bash
npm install
npx vite build                 # interfaccia web in web/dist
npm run seed                   # dati dimostrativi in ./data
DEV_OTP=1 npm start            # http://localhost:3000
```

Con `DEV_OTP=1` il codice di accesso compare a schermo invece di essere inviato via email. Accedi come `dirigente@scuola.edu.it` (amministrazione e presidenza) oppure come uno dei docenti dimostrativi (`marco.bianchi@scuola.edu.it`, `sara.ricci@scuola.edu.it`, …).

Per sviluppare l'interfaccia con ricarica automatica: `npm run dev` in un terminale e `npm run dev:web` in un altro (http://localhost:5173).

```bash
npm test          # test di integrazione (voto palese, voto segreto, quorum, verbale, audit)
npm run typecheck
```

## Configurazione

| Variabile | Significato |
|---|---|
| `SERVICE` | `all` (predefinito), `registry` oppure `urna`. In produzione è consigliato separare Registro e Urna. |
| `DATA_DIR` | Cartella dei database (`registro.db`, `urna.db`) |
| `PORT`, `HOST` | Indirizzo di ascolto |
| `URNA_URL`, `URNA_TOKEN` | Con `SERVICE=registry`: indirizzo dell'Urna e segreto condiviso per le chiamate interne |
| `ADMIN_EMAIL`, `ADMIN_NOME`, `ADMIN_COGNOME` | Primo amministratore, creato all'avvio se non esiste |
| `DEV_OTP=1` | Mostra il codice di accesso a schermo (vietato con `NODE_ENV=production`) |

## Stato e prossimi passi

- [x] Fase 1: sedute collegiali con voto palese e segreto, verbale, audit
- [ ] Invio email via SMTP e accesso con Google Workspace, Microsoft 365, SPID o CIE
- [ ] Verbale in PDF/A ed esportazione verso la conservazione; modelli di DPIA, nomina ex art. 28 e regolamento d'istituto
- [ ] Fase 2: elezioni dei rappresentanti di genitori e studenti (O.M. 215/1991)
- [ ] Audit di accessibilità WCAG 2.1 AA
