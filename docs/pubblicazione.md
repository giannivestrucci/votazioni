# Pubblicare la piattaforma online

Questa guida spiega come mettere la piattaforma su un server raggiungibile da internet, con HTTPS e l'invio dei codici di accesso via email. L'esempio usa **Aruba**, ma gli stessi passi valgono per qualsiasi server virtuale Linux (OVH, Hetzner, Register.it, …).

> **Perché non basta l'hosting Linux di Aruba.** I piani di hosting condiviso eseguono siti in PHP. La piattaforma è invece un programma Node.js che deve restare sempre acceso, quindi serve un server virtuale (VPS). Dell'hosting si usano comunque il **dominio** e le **caselle email**.

## Cosa serve

| Cosa | Dove | Note |
|---|---|---|
| Un server virtuale (VPS) Linux | Aruba Cloud → Cloud VPS | Basta il piano più piccolo (1 vCPU, 1-2 GB RAM). Sistema operativo **Ubuntu 24.04**. Datacenter italiano. |
| Un sottodominio, ad esempio `voto.tuascuola.edu.it` | Pannello di controllo dell'hosting → Gestione DNS | Un record di tipo **A** che punta all'indirizzo IP del VPS. |
| Una casella email per i codici | Pannello dell'hosting → Email | Ad esempio `noreply@tuascuola.edu.it`. Il server SMTP di Aruba è `smtps.aruba.it`, porta 465. |

Per una scuola statale va verificato con il DPO che il servizio cloud scelto sia **qualificato ACN** e che il fornitore sia nominato responsabile del trattamento (art. 28 GDPR), come chiede il §5-6 dell'Allegato tecnico.

## 1. Creare il server

1. In Aruba Cloud scegli **Cloud VPS**, sistema operativo **Ubuntu 24.04**.
2. Imposta la password di `root` (o una chiave SSH) e annota l'**indirizzo IP** del server.

## 2. Collegare il sottodominio

Nel pannello dell'hosting apri la gestione DNS del dominio e aggiungi:

| Tipo | Nome | Valore |
|---|---|---|
| A | `voto` | l'indirizzo IP del VPS |

La propagazione richiede da pochi minuti a qualche ora. Puoi controllare con `ping voto.tuascuola.edu.it`.

## 3. Installare la piattaforma

Collegati al server (da Windows con PowerShell, da Mac o Linux con il Terminale):

```bash
ssh root@INDIRIZZO_IP
```

Poi esegui:

```bash
curl -fsSL https://raw.githubusercontent.com/giannivestrucci/votazioni/main/deploy/installa.sh -o installa.sh
bash installa.sh
```

La prima volta lo script installa Docker, scarica la piattaforma in `/opt/votazioni` e crea il file di configurazione. Aprilo:

```bash
nano /opt/votazioni/deploy/.env
```

e compila i valori:

```ini
DOMINIO=voto.tuascuola.edu.it
ADMIN_EMAIL=dirigente@tuascuola.edu.it
ADMIN_NOME=Nome
ADMIN_COGNOME=Cognome
SMTP_URL=smtps://noreply%40tuascuola.edu.it:PASSWORD@smtps.aruba.it:465
SMTP_FROM="Votazioni <noreply@tuascuola.edu.it>"
```

Nell'utente SMTP la `@` va scritta `%40`. Se la password contiene caratteri speciali (`@ : / ? #`), scrivili anch'essi in forma codificata.

Salva (Ctrl+O, Invio, Ctrl+X) e rilancia lo script:

```bash
bash installa.sh
```

Dopo un minuto apri `https://voto.tuascuola.edu.it`: il certificato HTTPS viene ottenuto in automatico. Accedi con l'email dell'amministratore e il codice ricevuto per posta.

## 4. Copie di sicurezza

I dati sono in `/opt/votazioni/deploy/dati` (`registro.db` e `urna.db`). Per una copia ogni notte alle 2, conservata 30 giorni:

```bash
crontab -e
# aggiungi la riga:
0 2 * * * /opt/votazioni/deploy/backup.sh /opt/votazioni-backup
```

Conviene copiare periodicamente la cartella di backup anche fuori dal server. Molti fornitori offrono backup automatici del VPS a pagamento.

## 5. Aggiornare

```bash
bash /opt/votazioni/deploy/installa.sh
```

Lo script scarica l'ultima versione e riavvia la piattaforma senza toccare i dati.

## Comandi utili

```bash
cd /opt/votazioni/deploy
docker compose logs -f votazioni   # messaggi della piattaforma
docker compose restart             # riavvio
docker compose down                # arresto
```
