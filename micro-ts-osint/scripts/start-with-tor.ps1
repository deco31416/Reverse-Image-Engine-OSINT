$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "[TOR] ================================================" -ForegroundColor Magenta
Write-Host "[TOR]  DARK WEB INTELLIGENCE - SETUP LOCAL (Windows)"    -ForegroundColor Magenta
Write-Host "[TOR] ================================================" -ForegroundColor Magenta
Write-Host ""

# -- Paso 1: Verificar si Tor ya esta instalado --
$torExe = $null
$torPossiblePaths = @(
    (Join-Path $env:ProgramFiles "Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
    (Join-Path $env:USERPROFILE "Desktop\Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
    (Join-Path $env:LOCALAPPDATA "Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
    "C:\tools\tor\tor.exe",
    "C:\tor\tor.exe",
    "C:\tor\tor\tor.exe"
)

foreach ($p in $torPossiblePaths) {
    if (Test-Path $p) {
        $torExe = $p
        break
    }
}

if (-not $torExe) {
    $torInPath = Get-Command tor -ErrorAction SilentlyContinue
    if ($torInPath) { $torExe = $torInPath.Source }
}

if ($torExe) {
    Write-Host "[OK] Tor encontrado en: $torExe" -ForegroundColor Green
} else {
    Write-Host "[!!] Tor NO encontrado en el sistema" -ForegroundColor Red
    Write-Host ""
    Write-Host "[DL] Descargando Tor Expert Bundle automaticamente..." -ForegroundColor Yellow

    $torUrl = "https://archive.torproject.org/tor-package-archive/torbrowser/14.0.4/tor-expert-bundle-windows-x86_64-14.0.4.tar.gz"
    $torGz  = Join-Path $env:TEMP "tor-expert-bundle.tar.gz"
    $torDir = "C:\tor"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host "     URL: $torUrl" -ForegroundColor Gray
        Write-Host "     Destino: $torGz" -ForegroundColor Gray
        Invoke-WebRequest -Uri $torUrl -OutFile $torGz -UseBasicParsing
        Write-Host "[OK] Descargado" -ForegroundColor Green

        if (-not (Test-Path $torDir)) {
            New-Item -ItemType Directory -Force -Path $torDir | Out-Null
        }

        Write-Host "[..] Extrayendo en $torDir ..." -ForegroundColor Yellow
        tar -xzf $torGz -C $torDir 2>$null

        $found = Get-ChildItem -Path $torDir -Recurse -Filter "tor.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $torExe = $found.FullName
            Write-Host "[OK] Tor extraido en: $torExe" -ForegroundColor Green
        } else {
            Write-Host "[!!] No se encontro tor.exe en $torDir" -ForegroundColor Red
            Write-Host "     Descarga manual: https://www.torproject.org/download/tor/" -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Host "[!!] Error descargando Tor: $_" -ForegroundColor Red
        Write-Host "     Descarga manual: https://www.torproject.org/download/tor/" -ForegroundColor Yellow
        exit 1
    }
}

# -- Paso 2: Verificar si Tor ya esta corriendo --
Write-Host ""
$torRunning = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 9050)
    $tcp.Close()
    $torRunning = $true
    Write-Host "[OK] Tor SOCKS5 proxy ya esta corriendo en 127.0.0.1:9050" -ForegroundColor Green
} catch {
    Write-Host "[..] Tor no esta corriendo - iniciando..." -ForegroundColor Yellow
}

if (-not $torRunning) {
    Write-Host "[..] Iniciando Tor proxy en background..." -ForegroundColor Cyan

    $torProcess = Start-Process -FilePath $torExe -ArgumentList "--SocksPort","9050" -WindowStyle Hidden -PassThru

    Write-Host "     Tor PID: $($torProcess.Id)" -ForegroundColor Gray

    Write-Host "[..] Esperando que Tor se conecte a la red..." -ForegroundColor Yellow
    $maxWait = 60
    $waited = 0
    $ready = $false

    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("127.0.0.1", 9050)
            $tcp.Close()
            $ready = $true
            break
        } catch {
            Write-Host "     ... esperando ($waited s / $maxWait s)" -ForegroundColor Gray
        }
    }

    if ($ready) {
        Write-Host "[OK] Tor SOCKS5 proxy listo en 127.0.0.1:9050 ($waited s)" -ForegroundColor Green
    } else {
        Write-Host "[!!] Tor no arranco en $maxWait s - Dark Web search/scrape no funcionara" -ForegroundColor Yellow
        Write-Host "     Los pasos de IA (refine, filter, report) si funcionaran" -ForegroundColor Yellow
    }
}

# -- Paso 3: Iniciar micro-ts-osint --
Write-Host ""
Write-Host "[GO] ================================================" -ForegroundColor Cyan
Write-Host "[GO]  INICIANDO OSINT MICROSERVICE"                     -ForegroundColor Cyan
Write-Host "[GO] ================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location (Join-Path $PSScriptRoot "..")
yarn start:dev
