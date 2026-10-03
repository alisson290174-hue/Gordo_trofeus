# Manutenção de segurança do servidor do Balói (rodado pelo dono, no PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\server\scripts\security-maintenance.ps1
#
# 1. Gera um JWT_SECRET novo no próprio servidor (nunca passa por este PC).
#    As sessões longas ficam no banco, então ninguém é deslogado: os tokens de 1 h só se renovam.
# 2. Troca a STEAM_API_KEY (opcional): gere uma nova em https://steamcommunity.com/dev/apikey
#    ("Revogar" invalida a antiga). A chave vai pela entrada padrão e é conferida na Steam antes.
# 3. Instala um vigia (systemd timer) que confere /health a cada 2 min e reinicia o serviço se cair.
# Antes de mexer, o .env atual é copiado para .env.bak-<data> (só root lê).
#
# Os comandos vão para o servidor pela entrada padrão (bash -s): o PowerShell 5.1 quebra aspas
# dentro de argumentos de programas externos.

$ErrorActionPreference = "Stop"

function RemoteScript([string]$script) {
  ($script -replace "`r", "") | ssh baloi-vps "bash -s"
  if ($LASTEXITCODE -ne 0) { throw "Falhou no servidor." }
}

Write-Host "== Backup do .env e novo JWT_SECRET (gerado no servidor)" -ForegroundColor Cyan
RemoteScript @'
set -e
cd /opt/hydra-server
cp -p .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
chmod 600 .env .env.bak-*
secret=$(openssl rand -hex 48)
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$secret/" .env
grep -q "^JWT_SECRET=$secret$" .env && echo "JWT_SECRET trocado"
'@

$secure = Read-Host "Nova STEAM_API_KEY (Enter para manter a atual)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($key) {
  if ($key -notmatch '^[0-9A-Fa-f]{32}$') { throw "A chave da Steam tem 32 caracteres hexadecimais." }
  Write-Host "== Conferindo a chave na Steam e gravando" -ForegroundColor Cyan
  # A chave entra como a primeira linha do script: não aparece em linha de comando nem em histórico.
  RemoteScript ("read -r k <<'KEY'`n$key`nKEY`n" + @'
set -e
code=$(curl -s -o /dev/null -w '%{http_code}' "https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/?key=$k")
if [ "$code" != "200" ]; then echo "Steam recusou a chave (HTTP $code)"; exit 1; fi
cd /opt/hydra-server
sed -i "s/^STEAM_API_KEY=.*/STEAM_API_KEY=$k/" .env
echo "STEAM_API_KEY trocada"
'@)
}

Write-Host "== Reiniciando o servidor e instalando o vigia (a cada 2 min)" -ForegroundColor Cyan
RemoteScript @'
set -e
systemctl restart hydra-server
sleep 3
systemctl is-active hydra-server

cat > /etc/systemd/system/baloi-healthcheck.service <<'UNIT'
[Unit]
Description=Baloi: confere a saude do servidor e reinicia se cair

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'port=$(grep -E "^PORT=" /opt/hydra-server/.env | cut -d= -f2 | tr -d " "); curl -fsS --max-time 10 "http://127.0.0.1:${port:-3000}/health" >/dev/null || { echo "health falhou, reiniciando"; systemctl restart hydra-server; }'
UNIT

cat > /etc/systemd/system/baloi-healthcheck.timer <<'UNIT'
[Unit]
Description=Baloi: vigia do servidor a cada 2 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now baloi-healthcheck.timer
systemctl start baloi-healthcheck.service
systemctl is-active baloi-healthcheck.timer
'@

Write-Host ""
Write-Host "Pronto. Falta só o token do GitHub (feito por você no navegador):" -ForegroundColor Green
Write-Host "  1. https://github.com/settings/tokens -> revogue os tokens antigos"
Write-Host "  2. no PowerShell: gh auth logout; gh auth login   (escolha login pelo navegador)"
Write-Host "Ver o vigia: ssh baloi-vps journalctl -u baloi-healthcheck -n 20"
