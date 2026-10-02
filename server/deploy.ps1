# Publica o servidor na VPS: compila, envia, instala dependências (se mudaram), reinicia e confere.
# Uso (PowerShell):  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# Feito com arquivo + scp porque o "|" do PowerShell 5.1 corrompe dados binários (tar | ssh).
# Antes de trocar qualquer coisa guarda uma cópia do servidor atual; se o novo não subir, volta sozinho.

Set-Location $PSScriptRoot
$remote = "/opt/hydra-server"
$backup = "/opt/hydra-server-backup"

function Step($name, [scriptblock]$action) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $action
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FALHOU em: $name (codigo $LASTEXITCODE)" -ForegroundColor Red
    exit 1
  }
}

Step "Compilando" { yarn build }
Step "Empacotando src + dist + dependencias" { tar czf server.tgz src dist package.json yarn.lock }
Step "Enviando para a VPS" { scp server.tgz baloi-vps:/tmp/server.tgz }

Step "Guardando copia do servidor atual" {
  ssh baloi-vps "rm -rf $backup && mkdir -p $backup && cd $remote && cp -a dist package.json yarn.lock node_modules $backup/"
}

# Dependencies are reinstalled only when yarn.lock changed (e.g. the Fastify 5 upgrade).
$installAndRestart = @"
set -e
cd $remote
OLD_LOCK=`$(sha256sum yarn.lock | cut -d' ' -f1)
tar xzf /tmp/server.tgz && rm /tmp/server.tgz
NEW_LOCK=`$(sha256sum yarn.lock | cut -d' ' -f1)
if [ "`$OLD_LOCK" != "`$NEW_LOCK" ]; then
  echo 'yarn.lock mudou: instalando dependencias de producao'
  yarn install --production --frozen-lockfile --non-interactive
fi
systemctl restart hydra-server
sleep 4
systemctl is-active hydra-server
curl -sf http://127.0.0.1:`$(grep -E '^PORT=' .env | cut -d= -f2 || echo 3000)/health >/dev/null || curl -sf http://127.0.0.1:3000/health >/dev/null
"@ -replace "`r", ""

ssh baloi-vps $installAndRestart
if ($LASTEXITCODE -ne 0) {
  Write-Host "O servidor novo nao subiu. Voltando para a versao anterior..." -ForegroundColor Yellow
  ssh baloi-vps "cd $remote && rm -rf dist node_modules && cp -a $backup/dist $backup/node_modules $backup/package.json $backup/yarn.lock . && systemctl restart hydra-server && sleep 3 && systemctl is-active hydra-server"
  Write-Host "Versao anterior restaurada. Veja o erro com: ssh baloi-vps 'journalctl -u hydra-server -n 50'" -ForegroundColor Red
  Remove-Item server.tgz -ErrorAction SilentlyContinue
  exit 1
}
Remove-Item server.tgz -ErrorAction SilentlyContinue

$local = (Get-FileHash dist\index.js -Algorithm SHA256).Hash.ToLower()
$remoteHash = (ssh baloi-vps "sha256sum $remote/dist/index.js").Split(" ")[0]
if ($local -eq $remoteHash) {
  Write-Host "OK: servidor publicado, respondendo e conferido (dist/index.js)." -ForegroundColor Green
} else {
  Write-Host "ATENCAO: o dist/index.js da VPS nao confere com o local." -ForegroundColor Yellow
  exit 1
}
