# Publica o servidor na VPS: compila, envia, extrai e reinicia. Para no primeiro erro.
# Uso (PowerShell):  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# Feito com arquivo + scp porque o "|" do PowerShell 5.1 corrompe dados binários (tar | ssh).

Set-Location $PSScriptRoot

function Step($name, [scriptblock]$action) {
  Write-Host "==> $name" -ForegroundColor Cyan
  & $action
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FALHOU em: $name (codigo $LASTEXITCODE)" -ForegroundColor Red
    exit 1
  }
}

Step "Compilando" { yarn build }
Step "Empacotando src + dist" { tar czf server.tgz src dist }
Step "Enviando para a VPS" { scp server.tgz baloi-vps:/tmp/server.tgz }
Step "Extraindo e reiniciando" {
  ssh baloi-vps "cd /opt/hydra-server && tar xzf /tmp/server.tgz && rm /tmp/server.tgz && systemctl restart hydra-server && sleep 2 && systemctl is-active hydra-server"
}
Remove-Item server.tgz -ErrorAction SilentlyContinue

$local = (Get-FileHash dist\index.js -Algorithm SHA256).Hash.ToLower()
$remote = (ssh baloi-vps "sha256sum /opt/hydra-server/dist/index.js").Split(" ")[0]
if ($local -eq $remote) {
  Write-Host "OK: servidor publicado e reiniciado (dist/index.js confere)." -ForegroundColor Green
} else {
  Write-Host "ATENCAO: o dist/index.js da VPS nao confere com o local." -ForegroundColor Yellow
  exit 1
}
