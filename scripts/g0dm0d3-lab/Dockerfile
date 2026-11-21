# CIQ local evaluation lab wrapper: builds pinned, unmodified upstream source.
# Only use from scripts/g0dm0d3-lab/install.sh after SHA verification.
FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Upstream's API script calls tsx, which is a dev dependency. Include it here.
RUN npm ci --include=dev --no-audit --no-fund

COPY api/ ./api/
COPY src/lib/ ./src/lib/
COPY src/stm/ ./src/stm/

ENV NODE_ENV=production PORT=7860
EXPOSE 7860
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:7860/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "api"]
