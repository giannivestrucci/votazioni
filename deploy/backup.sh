#!/usr/bin/env bash
# Copia di sicurezza coerente dei database (da pianificare con cron, es. ogni notte).
set -euo pipefail
cd "$(dirname "$0")"
DEST=${1:-/opt/votazioni-backup}
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
for db in registro urna; do
  docker compose exec -T votazioni node -e "
    const { DatabaseSync } = require('node:sqlite');
    new DatabaseSync('/data/$db.db').exec(\"VACUUM INTO '/data/$db-$STAMP.bak'\");"
  mv "dati/$db-$STAMP.bak" "$DEST/"
done
find "$DEST" -name '*.bak' -mtime +30 -delete
echo "Backup salvato in $DEST"
