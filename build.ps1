# =============================================================================
#  build.ps1 — Génère MonInvestisseurIA.html : la version « un seul fichier »,
#  utilisable hors ligne d'un simple double-clic, sans serveur.
#
#  L'application déployée sur ton VPS n'a PAS besoin de ce fichier : elle sert
#  directement public/. Ce build sert de copie de secours locale.
#
#  Usage :  powershell -ExecutionPolicy Bypass -File build.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pub  = Join-Path $root 'public'

$html = Get-Content (Join-Path $pub 'index.html') -Raw -Encoding UTF8
$css  = Get-Content (Join-Path $pub 'css\app.css') -Raw -Encoding UTF8

# --- Polices IBM Plex Mono : converties en data: URI pour que le fichier
#     unique reste autonome et fonctionne hors ligne, sans dossier fonts/.
$fontDir = Join-Path $pub 'fonts'
if (Test-Path $fontDir) {
    foreach ($f in (Get-ChildItem $fontDir -Filter *.woff2)) {
        $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.FullName))
        $uri = 'data:font/woff2;base64,' + $b64
        $css = $css.Replace('../fonts/' + $f.Name, $uri)
    }
    Write-Host ("  polices integrees : " + (Get-ChildItem $fontDir -Filter *.woff2).Count) -ForegroundColor DarkGray
}

# Ordre de chargement identique à celui déclaré dans index.html
$order = @('api.js','data.js','store.js','market.js','vision.js','engine.js','agent.js','charts.js','ui.js','main.js')

$js = ''
foreach ($f in $order) {
    $path = Join-Path $pub ('js\' + $f)
    if (-not (Test-Path $path)) { throw "Fichier introuvable : $path" }
    $js += "`n/* ===== $f ===== */`n" + (Get-Content $path -Raw -Encoding UTF8) + "`n"
}

$html = $html -replace '(?m)^\s*<link rel="stylesheet" href="css/app\.css">\s*$', ("<style>`n" + $css + "`n</style>")

$scriptTags = '(?s)<script src="js/api\.js"></script>.*?<script src="js/main\.js"></script>'
$html = [regex]::Replace($html, $scriptTags, { param($m) "<script>`n" + $js + "`n</script>" })

if ($html -match '<script src=' -or $html -match '<link rel="stylesheet"') {
    throw "L'inlining a echoue : il reste des references externes."
}

$out = Join-Path $root 'MonInvestisseurIA.html'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($out, $html, $utf8NoBom)

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ""
Write-Host "  MonInvestisseurIA.html genere ($size Ko) - version hors ligne." -ForegroundColor Green
Write-Host ""
