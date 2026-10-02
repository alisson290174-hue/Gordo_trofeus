# Publica uma versão nova no feed de atualização do NOSSO servidor (/updates, só para quem está logado).
# Uso (PowerShell, na pasta Baloi):  powershell -ExecutionPolicy Bypass -File .\scripts\publish-update.ps1 1.0.15
# Envia o instalador, o .blockmap e o latest.yml (por último, para nenhum cliente ver o manifesto
# antes do instalador existir) e confere o hash de cada um. Para no primeiro erro.

param([Parameter(Mandatory = $true)][string]$Version)

Set-Location (Join-Path $PSScriptRoot "..\dist")
$remote = "/opt/hydra-server/updates"
$files = @(
  "Baloi-Launcher-$Version-setup.exe",
  "Baloi-Launcher-$Version-setup.exe.blockmap",
  "latest.yml"
)

foreach ($f in $files) {
  if (-not (Test-Path $f)) { Write-Host "FALTA: dist\$f" -ForegroundColor Red; exit 1 }
}
if (-not (Select-String -Path "latest.yml" -Pattern "version: $([regex]::Escape($Version))" -Quiet)) {
  Write-Host "O latest.yml nao e da versao $Version." -ForegroundColor Red; exit 1
}

ssh baloi-vps "mkdir -p $remote"
foreach ($f in $files) {
  Write-Host "==> Enviando $f" -ForegroundColor Cyan
  scp $f "baloi-vps:$remote/$f.part"
  if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU ao enviar $f" -ForegroundColor Red; exit 1 }
  $local = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
  $remoteHash = (ssh baloi-vps "sha256sum $remote/$f.part").Split(" ")[0]
  if ($local -ne $remoteHash) { Write-Host "Hash diferente em $f" -ForegroundColor Red; exit 1 }
  # Rename in place: clients never see a half-uploaded file.
  ssh baloi-vps "mv -f $remote/$f.part $remote/$f"
}

# Keep only the current version's installer and blockmap on the server.
ssh baloi-vps "cd $remote && ls Baloi-Launcher-*-setup.exe* 2>/dev/null | grep -v '$Version' | xargs -r rm -f"
Write-Host "OK: versao $Version publicada no feed de atualizacao." -ForegroundColor Green
