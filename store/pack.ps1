# Собирает подписанный x64 MSIX для загрузки в Microsoft Store.
# Идентичность берётся из Package.appxmanifest и должна совпадать
# со страницей «Идентификационные данные продукта».
$ErrorActionPreference = "Stop"

$store = $PSScriptRoot
$root = Resolve-Path (Join-Path $store "..")
$exe = Join-Path $root "src-tauri\target\release\tauri-app.exe"
$manifest = Join-Path $store "Package.appxmanifest"
$layout = Join-Path $store "out\layout"
$msix = Join-Path $store "out\CocosApps.Aitu_0.1.0.0_x64.msix"
$makeappx = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe"
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
$publisher = "CN=CCB0C5AC-BA1E-4AA5-BA5A-C2C75FE3C80A"

if (-not (Test-Path $exe)) {
  throw "Нет $exe. Сначала: npm run tauri build -- --no-bundle"
}

if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $layout "Assets") -Force | Out-Null
Copy-Item $exe (Join-Path $layout "tauri-app.exe")
Copy-Item $manifest (Join-Path $layout "AppxManifest.xml")
foreach ($name in @("StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png", "Square71x71Logo.png", "Square310x310Logo.png")) {
  Copy-Item (Join-Path $root "src-tauri\icons\$name") (Join-Path $layout "Assets\$name")
}
Copy-Item (Join-Path $store "Wide310x150Logo.png") (Join-Path $layout "Assets\Wide310x150Logo.png")

New-Item -ItemType Directory -Path (Join-Path $store "out") -Force | Out-Null
if (Test-Path $msix) { Remove-Item $msix -Force }
& $makeappx pack /d $layout /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx завершился с кодом $LASTEXITCODE" }

$existing = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $publisher -and $_.HasPrivateKey })
if ($existing.Count -eq 0) {
  New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature -FriendlyName "CocosApps Aitu dev" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") | Out-Null
}
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $publisher -and $_.HasPrivateKey } | Select-Object -First 1

& $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix
if ($LASTEXITCODE -ne 0) { throw "signtool завершился с кодом $LASTEXITCODE" }

Write-Output $msix
