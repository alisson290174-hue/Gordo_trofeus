#!/usr/bin/env bash
# Endurece o VPS do Opus: SSH só por chave, fail2ban contra força bruta e atualizações de segurança.
# Seguro de rodar mais de uma vez. Não mexe no banco nem no .env da API.
set -euo pipefail

echo "== 1/4 conferindo que existe chave autorizada (senão abortar para não trancar o acesso)"
if ! grep -qE '^(ssh-|ecdsa-)' /root/.ssh/authorized_keys 2>/dev/null; then
  echo "ERRO: nenhuma chave em /root/.ssh/authorized_keys. Abortando."; exit 1
fi

echo "== 2/4 SSH: desligar login por senha (root continua entrando, só com chave)"
cat > /etc/ssh/sshd_config.d/10-opus-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 30
EOF
sshd -t                      # valida a configuração antes de aplicar
systemctl reload ssh || systemctl reload sshd

echo "== 3/4 fail2ban: bloqueia por 1h quem erra 5 vezes em 10 min"
DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban >/dev/null
cat > /etc/fail2ban/jail.d/opus-sshd.local <<'EOF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban
sleep 2
fail2ban-client status sshd | sed -n '1,6p'

echo "== 4/4 atualizações do sistema (inclui Caddy, Node e kernel)"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold upgrade >/dev/null
systemctl is-active hydra-server caddy

echo
echo "Pronto. Se aparecer 'reboot-required' abaixo, reinicie com: reboot"
ls /var/run/reboot-required 2>/dev/null || echo "Reinício não necessário."
