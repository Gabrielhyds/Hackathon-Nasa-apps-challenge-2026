#!/usr/bin/env bash
# Publica a demo num Space do Hugging Face (SDK Docker, gratuito): um contêiner só, com o front e a API.
#
#   bash deploy/space/publish.sh <usuario>/<nome-do-space>
#   bash deploy/space/publish.sh <usuario>/<nome-do-space> --sem-enviar    monta a pasta e para antes do push
#
# Antes: criar o Space em huggingface.co/new-space (SDK Docker, público) e um token de escrita em
# huggingface.co/settings/tokens. O push pede usuário e senha: a senha é o token.
#
# O que faz: copia os arquivos do repositório como estão na pasta (com o que ainda não foi commitado, sem o
# .env nem o que o .gitignore exclui) para uma pasta temporária, põe deploy/space/Dockerfile na raiz, junta
# header.md (a configuração do Space) ao README, marca imagens e pacotes do globo como LFS, que o Hugging Face
# exige para binários, e envia com --force: o Space fica igual a esta pasta, sem histórico.
#
# O Space constrói a imagem sozinho (uns minutos) e serve em https://<usuario>-<nome-do-space>.hf.space.
# Sem AGENT_URL, a aba Ask responde com o texto de exemplo; para ligar o agente, definir AGENT_URL e
# AGENT_API_KEY em Settings > Variables and secrets do Space.
set -euo pipefail

SPACE="${1:?uso: bash deploy/space/publish.sh <usuario>/<nome-do-space> [--sem-enviar]}"
cd "$(git rev-parse --show-toplevel)"

OUT="$(mktemp -d)"
git ls-files -z --cached --others --exclude-standard -- . ':!.claude' | tar --null -T - -cf - | tar -xf - -C "$OUT"
cp deploy/space/Dockerfile "$OUT/Dockerfile"
cat deploy/space/header.md README.md > "$OUT/README.md"

cd "$OUT"
git init -q -b main
git lfs install --local >/dev/null
git lfs track "*.png" "*.jpg" "*.bin" >/dev/null
git add -A
git commit -q -m "Nexxus: demo do NASA Space Apps Challenge 2026"

if [ "${2:-}" = "--sem-enviar" ]; then
  echo "Pasta pronta, sem enviar: $OUT"
  exit 0
fi
git push --force "https://huggingface.co/spaces/$SPACE" main
echo "Enviado. Acompanhe o build em https://huggingface.co/spaces/$SPACE"
