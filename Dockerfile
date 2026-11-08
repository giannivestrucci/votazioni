# Immagine di produzione della piattaforma Votazioni.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0

COPY package.json package-lock.json ./
# Servono anche le dipendenze di sviluppo: tsx esegue il TypeScript e Vite costruisce l'interfaccia.
RUN npm ci --include=dev && npm cache clean --force

COPY . .
RUN npx vite build

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
