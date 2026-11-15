# Contexto: raiz do repositório (o front usa o pacote packages/contract).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
ARG VITE_API_MODE=http
ARG VITE_API_URL=/api
ENV VITE_API_MODE=$VITE_API_MODE VITE_API_URL=$VITE_API_URL
RUN npm run build -w @nexxus/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
