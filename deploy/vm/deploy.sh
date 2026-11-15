#!/bin/bash
# Deploy na máquina da demo: atualiza ~/nexxus, sobe os serviços de novo e mostra o health.
# Fica em ~/deploy.sh na VM. Mudou aqui: scp deploy/vm/deploy.sh nexxus:deploy.sh
#
# Uso, da máquina de quem tem acesso:
#   ssh nexxus ./deploy.sh                  sobe a main
#   ssh nexxus ./deploy.sh minha-branch     sobe uma branch, para testar antes do merge
#
# O site público mostra o que subiu por último: depois de testar uma branch, rode de novo sem argumento.
# Para no primeiro erro; se alguém editou arquivo dentro de ~/nexxus, o git recusa e nada sobe.
set -e
BRANCH="${1:-main}"
cd ~/nexxus
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "Subindo: $(git log --oneline -1 | cut -c1-100)"
sudo docker compose up -d --build
sleep 10
curl -s localhost/api/health
echo
