# Demo num contêiner só, para o Hugging Face Spaces (SDK Docker): o nginx serve o front na porta 7860
# e repassa /api/ para a API, que roda ao lado, na 3000. A demo local continua no docker-compose.yml.
#
# Contexto: raiz do repositório. No Space, este arquivo vai para a raiz com o nome Dockerfile
# (deploy/space/publish.sh faz isso e envia).
#
# Testar aqui:  docker build -f deploy/space/Dockerfile -t nexxus-space . && docker run --rm -p 7860:7860 nexxus-space
FROM node:22-alpine
RUN apk add --no-cache nginx
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
ENV VITE_API_MODE=http VITE_API_URL=/api
RUN npm run build

# o Space roda como o usuário 1000 (aqui, `node`): o nginx só escreve em /tmp
RUN chown -R node:node /var/lib/nginx /var/log/nginx
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 7860
# o nginx vai para o fundo; a API fica na frente, e se ela cair o contêiner cai e o Space reinicia
CMD ["sh", "-c", "nginx -c /repo/deploy/space/nginx.conf && exec node apps/api/dist/main.js"]
