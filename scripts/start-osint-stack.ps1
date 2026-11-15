param(
  [int]$DelaySeconds = 3,
  [switch]$NoRestartOccupied
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$LauncherDir = Join-Path $Root ".runtime-launchers"

function Get-ShellExecutable {
  $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  return "powershell.exe"
}

function Escape-SingleQuoted {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function Get-PortOwner {
  param([int]$Port)

  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) {
    return $null
  }

  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  return [PSCustomObject]@{
    Port = $Port
    ProcessId = $connection.OwningProcess
    ProcessName = if ($process) { $process.ProcessName } else { "unknown" }
    Path = if ($process) { $process.Path } else { "" }
  }
}

function Get-ProjectProcessMatches {
  param(
    [hashtable]$Project
  )

  $safeName = ($Project.Key -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
  $launcherName = "$safeName.ps1"
  $projectPath = [string]$Project.Path
  $launcherPath = Join-Path $LauncherDir $launcherName

  Get-CimInstance Win32_Process |
    Where-Object {
      $commandLine = [string]$_.CommandLine
      if (-not $commandLine) { return $false }
      if ($_.ProcessId -eq $PID) { return $false }
      $commandLine.Contains($projectPath) -or
        $commandLine.Contains($launcherPath)
    } |
    Sort-Object ProcessId -Descending
}

function Stop-ProjectProcesses {
  param(
    [hashtable]$Project
  )

  $matches = @(Get-ProjectProcessMatches -Project $Project)
  foreach ($match in $matches) {
    try {
      Write-Host "  Cerrando proceso viejo: $($match.Name) ($($match.ProcessId))" -ForegroundColor DarkYellow
      Stop-Process -Id $match.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host "  No se pudo cerrar $($match.Name) ($($match.ProcessId)): $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }
}

function New-LauncherFile {
  param(
    [hashtable]$Project
  )

  $safeName = ($Project.Key -replace "[^a-zA-Z0-9_-]", "-").ToLowerInvariant()
  $filePath = Join-Path $LauncherDir "$safeName.ps1"
  $title = Escape-SingleQuoted $Project.Title
  $label = Escape-SingleQuoted $Project.Label
  $path = Escape-SingleQuoted $Project.Path
  $command = Escape-SingleQuoted $Project.Command
  $url = Escape-SingleQuoted $Project.Url
  $color = Escape-SingleQuoted $Project.Color
  $port = Escape-SingleQuoted ([string]$Project.Port)

  $content = @"
`$Host.UI.RawUI.WindowTitle = '$title'
Clear-Host
function Get-PortOwner {
  param([int]`$Port)
  `$connection = Get-NetTCPConnection -LocalPort `$Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not `$connection) { return `$null }
  `$process = Get-Process -Id `$connection.OwningProcess -ErrorAction SilentlyContinue
  return [PSCustomObject]@{
    Port = `$Port
    ProcessId = `$connection.OwningProcess
    ProcessName = if (`$process) { `$process.ProcessName } else { 'unknown' }
    Path = if (`$process) { `$process.Path } else { '' }
  }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor $color
Write-Host '  OSINT-Deco :: $label' -ForegroundColor $color
Write-Host '============================================================' -ForegroundColor $color
Write-Host ''
Write-Host 'Ruta    : $path' -ForegroundColor Gray
Write-Host 'Puerto  : $port' -ForegroundColor Gray
Write-Host 'URL     : $url' -ForegroundColor Yellow
Write-Host 'Comando : $command' -ForegroundColor Gray
Write-Host ''
Write-Host 'Logs visibles en esta ventana. Si falla, copia el error desde aqui.' -ForegroundColor DarkGray
Write-Host '============================================================' -ForegroundColor $color
Write-Host ''
Set-Location -LiteralPath '$path'
try {
  `$owner = Get-PortOwner -Port $port
  if (`$owner) {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Yellow
    Write-Host '  PUERTO OCUPADO: $port' -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Yellow
    Write-Host "El servicio $label no se levanto porque el puerto $port ya esta en uso." -ForegroundColor Yellow
    Write-Host "Proceso : `$(`$owner.ProcessName) (`$(`$owner.ProcessId))" -ForegroundColor Gray
    if (`$owner.Path) { Write-Host "Ruta    : `$(`$owner.Path)" -ForegroundColor Gray }
    Write-Host ''
    Write-Host 'Si quieres reiniciarlo, cierra ese proceso y vuelve a ejecutar el launcher.' -ForegroundColor DarkGray
    return
  }
  Invoke-Expression '$command'
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor $color
  Write-Host '  El proceso termino. Revisa si fue un cierre esperado.' -ForegroundColor $color
  Write-Host '============================================================' -ForegroundColor $color
} catch {
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host '  ERROR levantando $label' -ForegroundColor Red
  Write-Host '============================================================' -ForegroundColor Red
  Write-Host `$_.Exception.Message -ForegroundColor Red
}
Write-Host ''
Write-Host 'Presiona ENTER para cerrar esta ventana...' -ForegroundColor Yellow
Read-Host
"@

  Set-Content -LiteralPath $filePath -Value $content -Encoding UTF8
  return $filePath
}

function Start-VisibleProject {
  param(
    [hashtable]$Project
  )

  if (-not (Test-Path -LiteralPath $Project.Path)) {
    throw "No existe la carpeta del proyecto: $($Project.Path)"
  }

  $owner = Get-PortOwner -Port ([int]$Project.Port)
  if ($owner) {
    $ownedProcesses = @(Get-ProjectProcessMatches -Project $Project)
    if ($owner.ProcessId -notin $ownedProcesses.ProcessId) {
      Write-Host "Saltando $($Project.Label): el puerto pertenece a un proceso ajeno al proyecto. No se cerrará." -ForegroundColor Yellow
      return
    }
    if (-not $NoRestartOccupied) {
      Write-Host "Reiniciando $($Project.Label): puerto $($Project.Port) ocupado por $($owner.ProcessName) ($($owner.ProcessId))." -ForegroundColor Yellow
      Stop-ProjectProcesses -Project $Project
      Start-Sleep -Seconds 1
      $ownerAfterStop = Get-PortOwner -Port ([int]$Project.Port)
      if ($ownerAfterStop) {
        Write-Host "El puerto $($Project.Port) sigue ocupado; no se cerrarán procesos adicionales." -ForegroundColor Yellow
        return
      }
    } else {
      Write-Host "Saltando $($Project.Label): puerto $($Project.Port) ya esta ocupado." -ForegroundColor Yellow
      Write-Host "  Proceso: $($owner.ProcessName) ($($owner.ProcessId))" -ForegroundColor Gray
      if ($owner.Path) {
        Write-Host "  Ruta: $($owner.Path)" -ForegroundColor DarkGray
      }
      Write-Host "  URL: $($Project.Url)" -ForegroundColor Yellow
      Write-Host "  Tip: ejecuta sin -NoRestartOccupied para cerrar procesos viejos y abrir ventanas limpias." -ForegroundColor DarkGray
      return
    }
  }

  $shell = Get-ShellExecutable
  $launcher = New-LauncherFile -Project $Project

  Write-Host "Levantando $($Project.Label)..." -ForegroundColor $Project.Color
  Write-Host "  URL: $($Project.Url)" -ForegroundColor Yellow
  Start-Process -FilePath $shell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $launcher
  )
}

New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null

$projects = @(
  @{
    Key = "biometric"
    Label = "FACE BIOMETRIC"
    Title = "OSINT-Deco | BIOMETRIC 7120"
    Path = Join-Path $Root "face-biometric-service"
    Command = "if (-not (Test-Path -LiteralPath '.env.local')) { throw 'Falta face-biometric-service\.env.local. Copia .env.example o migra tu .env local antes de levantar este servicio.' }; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 7120 --reload --env-file .env.local"
    Port = 7120
    Url = "http://localhost:7120/health"
    Color = "Blue"
  },
  @{
    Key = "visual-context"
    Label = "VISUAL CONTEXT"
    Title = "OSINT-Deco | VISUAL CONTEXT 7130"
    Path = Join-Path $Root "visual-context-service"
    Command = "if (-not (Test-Path -LiteralPath '.env.local')) { throw 'Falta visual-context-service\.env.local. Copia .env.example o crea tus variables locales antes de levantar este servicio.' }; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 7130 --reload --env-file .env.local"
    Port = 7130
    Url = "http://localhost:7130/health"
    Color = "DarkCyan"
  },
  @{
    Key = "micro"
    Label = "MICRO PRINCIPAL"
    Title = "OSINT-Deco | MICRO 7105"
    Path = Join-Path $Root "micro-ts-osint"
    Command = "yarn start:dev"
    Port = 7105
    Url = "http://localhost:7105/api/v1/osint/health"
    Color = "Cyan"
  },
  @{
    Key = "scraper"
    Label = "SOCIAL SCRAPER"
    Title = "OSINT-Deco | SCRAPER 7110"
    Path = Join-Path $Root "osint-social-scraper"
    Command = "yarn start:dev"
    Port = 7110
    Url = "http://localhost:7110/api/v1/health"
    Color = "Green"
  },
  @{
    Key = "dashboard"
    Label = "DASHBOARD"
    Title = "OSINT-Deco | DASHBOARD 3003"
    Path = Join-Path $Root "dashboard-osint"
    Command = "pnpm run dev"
    Port = 3003
    Url = "http://localhost:3003"
    Color = "Magenta"
  }
)

Write-Host ''
Write-Host '============================================================' -ForegroundColor White
Write-Host '  OSINT-Deco launcher visible' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White
Write-Host "Delay entre servicios: $DelaySeconds segundo(s)" -ForegroundColor Gray
Write-Host "Reiniciar puertos ocupados: $(-not $NoRestartOccupied.IsPresent)" -ForegroundColor Gray
Write-Host ''

foreach ($project in $projects) {
  Start-VisibleProject -Project $project
  if ($project -ne $projects[-1]) {
    Start-Sleep -Seconds $DelaySeconds
  }
}

Write-Host ''
Write-Host 'Ventanas abiertas:' -ForegroundColor White
Write-Host '  FACE BIOMETRIC  : http://localhost:7120/health' -ForegroundColor Blue
Write-Host '  VISUAL CONTEXT  : http://localhost:7130/health' -ForegroundColor DarkCyan
Write-Host '  MICRO PRINCIPAL : http://localhost:7105/api/v1/osint/health' -ForegroundColor Cyan
Write-Host '  SOCIAL SCRAPER  : http://localhost:7110/api/v1/health' -ForegroundColor Green
Write-Host '  DASHBOARD       : http://localhost:3003' -ForegroundColor Magenta
Write-Host ''
Write-Host 'Abre el dashboard cuando veas que los micros terminaron de compilar.' -ForegroundColor Yellow
