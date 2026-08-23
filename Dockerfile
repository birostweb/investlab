# =============================================================================
#  Mon Investisseur IA — image de production
#  Aucune dépendance npm : rien à installer, build quasi instantané.
# =============================================================================
FROM node:22-alpine

# curl sert au HEALTHCHECK ci-dessous
RUN apk add --no-cache curl

WORKDIR /app

# L'application ne contient que du code : on copie tel quel.
COPY server/ ./server/
COPY public/ ./public/

# Le volume de données appartient à l'utilisateur non privilégié
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/server.js"]
