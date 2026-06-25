# TronBrowser auth/sync API. Self-contained build (context = services/api), so
# it doesn't pick up the repo-root Caddy Dockerfile. Railway: set this service's
# Root Directory to "services/api". Migrations are applied separately
# (`doppler run -- pnpm db:migrate`); the container just serves.
FROM node:24-slim
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
# Standalone tsconfig (the repo one extends ../../tsconfig.base.json).
RUN printf '%s' '{"compilerOptions":{"target":"ES2023","module":"NodeNext","moduleResolution":"NodeNext","outDir":"dist","rootDir":"src","strict":true,"skipLibCheck":true,"esModuleInterop":true},"include":["src"]}' > tsconfig.build.json \
  && npx tsc -p tsconfig.build.json

ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]

