# Architettura

## Principio: chi sa *chi* vota non sa *cosa* vota

```
            ┌─────────────────────────────┐          ┌───────────────────────────┐
 Browser ──▶│ REGISTRO  /api              │          │ URNA  /urna               │◀── Browser
 (cookie)   │ identità, ruoli, presenze,  │ apre /   │ schede, conteggio,        │   (nessun cookie)
            │ quorum, voti palesi,        │ chiude ─▶│ bacheca delle ricevute    │
            │ firma cieca dei gettoni,    │ (token   │                           │
            │ verbale, audit              │ interno) │ non conosce identità,     │
            │ registro.db                 │          │ IP, orari │ urna.db       │
            └─────────────────────────────┘          └───────────────────────────┘
```

I due servizi hanno **database separati** e possono girare su host diversi (`SERVICE=registry` e `SERVICE=urna`). In sviluppo e nelle piccole installazioni girano nello stesso processo (`SERVICE=all`), ma con file distinti.

## Voto segreto, passo per passo (RFC 9474, RSABSSA-SHA384-PSS-Randomized)

1. All'apertura della votazione il Registro genera una coppia di chiavi RSA dedicata e consegna all'Urna la chiave pubblica.
2. Il browser dell'elettore genera un gettone casuale e lo **acceca** con la chiave pubblica.
3. Il Registro verifica che l'elettore sia tra gli aventi diritto (presenti all'apertura) e che non abbia già ritirato un gettone. Firma quindi il gettone accecato **senza poterlo vedere** e registra solo che il gettone è stato ritirato.
4. Il browser toglie l'accecamento e ottiene una firma valida sul gettone in chiaro. Il Registro non ha mai visto né l'uno né l'altra.
5. Il browser deposita nell'Urna il gettone, la firma e la scelta, senza cookie. L'Urna verifica la firma, rifiuta i gettoni già usati e restituisce una **ricevuta** (SHA-256 del gettone).
6. Alla chiusura il Registro comunica all'Urna il numero di gettoni rilasciati. L'Urna scrutina e segnala un'anomalia se le schede superano i gettoni. Pubblica poi l'elenco ordinato delle ricevute e la sua impronta. La chiave privata viene distrutta.

**Cosa garantisce**
- Il Registro conosce l'identità ma non la scelta; l'Urna conosce la scelta ma non l'identità.
- Ogni elettore può controllare che la propria ricevuta compaia nella bacheca.
- Il conteggio delle schede è confrontabile con i gettoni rilasciati.
- Nell'Urna non restano orari né ordine di inserimento da incrociare con il Registro.

**Rischi residui (da indicare nella DPIA)**
- Chi gestisce *entrambi* i server e osserva il traffico in tempo reale potrebbe correlare gli orari tra ritiro del gettone e deposito della scheda. Si mitiga separando la gestione dei due servizi (ad esempio due fornitori o due amministratori diversi). Un ritardo casuale lato client è previsto in una fase successiva.
- La ricevuta dimostra l'inclusione della scheda ma non la scelta fatta. È voluto: impedisce di dimostrare a terzi come si è votato.

## Moduli

| Percorso | Contenuto |
|---|---|
| `src/shared/` | Database SQLite (`node:sqlite`), funzioni crittografiche, registro di audit a catena di hash |
| `src/urna/` | Servizio Urna e client usato dal Registro |
| `src/registry/` | Autenticazione OTP, organi e sedute, presenze e quorum, votazioni, verbale PDF |
| `web/` | Interfaccia React (Vite), incluso il protocollo di voto segreto lato client (`votoSegreto.ts`) |
| `test/` | Test di integrazione dell'intero flusso |

## Regole di voto implementate

- **Numero legale**: metà più uno dei componenti in carica (art. 37 c.2 D.Lgs. 297/1994), verificato all'apertura di ogni votazione deliberativa.
- **Maggioranza**: assoluta dei voti validamente espressi. In caso di parità nel voto palese prevale il voto del presidente; nel voto segreto la parità respinge (art. 37 c.3).
- **Voto segreto** quando si tratta di persone (art. 37 c.4): lo sceglie il presidente alla creazione della votazione.
- **Aventi diritto**: i componenti presenti all'apertura della votazione.
