#!/usr/bin/env bash
# Installazione su un server Ubuntu/Debian appena creato (es. VPS Aruba Cloud).
# Da eseguire come root: bash installa.sh
set -euo pipefail

if ! command -v docker >/dev/null; then
  echo "Installo Docker..."
  curl -fsSL https://get.docker.com | sh
fi

DIR=/opt/votazioni
if [ ! -d "$DIR" ]; then
  git --version >/dev/null 2>&1 || (apt-get update && apt-get install -y git)
  git clone https://github.com/giannivestrucci/votazioni.git "$DIR"
else
  git -C "$DIR" pull --ff-only
fi

cd "$DIR/deploy"
if [ ! -f .env ]; then
  cp .env.esempio .env
  echo
  echo "Ho creato $DIR/deploy/.env: aprilo (nano .env), compila i valori e rilancia questo script."
  exit 0
fi

mkdir -p dati && chown 1000:1000 dati
docker compose up -d --build
echo
echo "Fatto. Tra un minuto la piattaforma risponde su https://$(grep ^DOMINIO= .env | cut -d= -f2)"
