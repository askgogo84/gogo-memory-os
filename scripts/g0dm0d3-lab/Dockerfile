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

# Pinned upstream v0.4.0 uses an Express 4 catch-all route. Express 5 requires
# a named wildcard; join captured path segments for the existing path validator.
# Keep this change inside the isolated third-party lab image only.
RUN sed -i "s|researchRoutes.get('/batch/\\*'|researchRoutes.get('/batch/*file'|" api/routes/research.ts \\
 && sed -i "s|const filePath = req.params\\[0\\]|const filePath = Array.isArray(req.params.file) ? req.params.file.join('/') : req.params.file|" api/routes/research.ts \\
 && grep -Fq "researchRoutes.get('/batch/*file'" api/routes/research.ts \\
 && grep -Fq "req.params.file.join('/')" api/routes/research.ts

ENV NODE_ENV=production PORT=7860
EXPOSE 7860
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:7860/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "api"]
