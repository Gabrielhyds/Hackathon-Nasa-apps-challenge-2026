# Contexto: raiz do repositório (a API usa o pacote packages/contract).
FROM node:22-alpine
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/contract packages/contract
COPY apps/api apps/api
RUN npm run build -w @nexxus/contract && npm run build -w @nexxus/api
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
