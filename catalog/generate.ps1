# Builds src/data/catalog.json with the free local Elasticsearch distribution.
# Java loads DummyJSON. Python adds sale prices and similar-product ids.
# The Elasticsearch install stays in catalog/.tools and is not committed.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $PSScriptRoot ".tools"
$version = "8.18.2"
$zipName = "elasticsearch-$version-windows-x86_64.zip"
$zipUrl = "https://artifacts.elastic.co/downloads/elasticsearch/$zipName"
$jsonJar = Join-Path $tools "json-20240303.jar"
$jsonUrl = "https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar"
$esHome = Join-Path $tools "elasticsearch-$version"
$build = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force -Path $tools, $build | Out-Null

function Get-File($url, $dest) {
    if (Test-Path $dest) { return }
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

Get-File $jsonUrl $jsonJar
$zipPath = Join-Path $tools $zipName
Get-File $zipUrl $zipPath
if (-not (Test-Path (Join-Path $esHome "bin\elasticsearch.bat"))) {
    Write-Host "Extracting Elasticsearch"
    Expand-Archive -Path $zipPath -DestinationPath $tools -Force
}

$javac = Get-ChildItem -Path $esHome -Filter javac.exe -Recurse | Select-Object -First 1
if (-not $javac) { throw "The Elasticsearch JDK was not found." }

$up = $false
try {
    $busy = Invoke-WebRequest -Uri "http://127.0.0.1:9200" -UseBasicParsing -TimeoutSec 2
    if ($busy.StatusCode -eq 200) { $up = $true }
} catch {
    $up = $false
}
if ($up) { throw "Something is already listening on port 9200. Stop it, then run this script again." }

$env:ES_JAVA_OPTS = "-Xms512m -Xmx512m"
$esArgs = @(
    "-Ediscovery.type=single-node",
    "-Ehttp.host=127.0.0.1",
    "-Ehttp.port=9200",
    "-Expack.security.enabled=false",
    "-Expack.security.enrollment.enabled=false",
    "-Expack.security.http.ssl.enabled=false",
    "-Expack.ml.enabled=false",
    "-Eingest.geoip.downloader.enabled=false"
)
$log = Join-Path $tools "elasticsearch.log"
$proc = Start-Process -FilePath (Join-Path $esHome "bin\elasticsearch.bat") `
    -ArgumentList $esArgs `
    -WorkingDirectory $esHome `
    -RedirectStandardOutput $log `
    -RedirectStandardError (Join-Path $tools "elasticsearch.err.log") `
    -PassThru `
    -WindowStyle Hidden

try {
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 2
        try {
            $health = Invoke-WebRequest -Uri "http://127.0.0.1:9200" -UseBasicParsing -TimeoutSec 3
            if ($health.StatusCode -eq 200) { $ready = $true; break }
        } catch {
            # Still starting.
        }
    }
    if (-not $ready) {
        Write-Host (Get-Content $log -Tail 40 -ErrorAction SilentlyContinue)
        throw "Elasticsearch did not start. See $log"
    }

    & $javac.FullName -encoding UTF-8 -cp $jsonJar -d $build (Join-Path $PSScriptRoot "Indexer.java")
    if ($LASTEXITCODE -ne 0) { throw "javac failed" }
    $java = Join-Path $javac.DirectoryName "java.exe"
    & $java -cp "$build;$jsonJar" Indexer
    if ($LASTEXITCODE -ne 0) { throw "Indexer failed" }

    python (Join-Path $PSScriptRoot "enrich.py")
    if ($LASTEXITCODE -ne 0) { throw "enrich.py failed" }
} finally {
    if ($proc -and -not $proc.HasExited) {
        try { & taskkill /PID $proc.Id /T /F | Out-Null } catch {}
    }
}
