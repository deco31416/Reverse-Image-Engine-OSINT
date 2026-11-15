param([switch]$Restart, [string[]]$Service = @(), [switch]$DashboardDev)
$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $workspaceRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodePath = (Get-Command node.exe).Source
$env:YOLO_CONFIG_DIR = Join-Path $runtimeDir 'ultralytics'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:PUPPETEER_CACHE_DIR = Join-Path $runtimeDir 'puppeteer'
function Test-ProjectProcess {
  param([int]$ProcessId, [string]$ProjectDirectory, [bool]$Python)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  $commandLine = ([string]$processInfo.CommandLine).Replace('/', '\')
  if ($commandLine.IndexOf($ProjectDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  if ($Python -and $processInfo.ParentProcessId) {
    # Windows venv python.exe redirects to the shared interpreter. Its parent
    # still identifies the exact project virtualenv that launched the listener.
    $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($processInfo.ParentProcessId)"
    $venvExecutable = Join-Path $ProjectDirectory '.venv\Scripts\python.exe'
    return ([string]$parentInfo.CommandLine).Replace('/', '\').IndexOf($venvExecutable, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  if ($processInfo.ParentProcessId) {
    # Next dev runs the listener in a child process of the project-specific CLI.
    $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($processInfo.ParentProcessId)"
    $nextCli = Join-Path $ProjectDirectory 'node_modules\next\dist\bin\next'
    return ([string]$parentInfo.CommandLine).Replace('/', '\').IndexOf($nextCli, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  return $false
}
$projects = @(
  @{ Name='face-biometric'; Folder='face-biometric-service'; Port=7120; Python=$true },
  @{ Name='visual-context'; Folder='visual-context-service'; Port=7130; Python=$true },
  @{ Name='social-scraper'; Folder='osint-social-scraper'; Port=7110; Python=$false },
  @{ Name='osint-core'; Folder='micro-ts-osint'; Port=7105; Python=$false },
  @{ Name='dashboard'; Folder='dashboard-osint'; Port=3003; Python=$false }
)
if ($Service.Count -gt 0) {
  foreach ($name in $Service) {
    if ($name -notin $projects.Name) { throw "Unknown service: $name" }
  }
  $projects = @($projects | Where-Object { $_.Name -in $Service })
}
# Check required files before interrupting any running service.
foreach ($project in $projects) {
  $projectDir = Join-Path $workspaceRoot $project.Folder
  $requiredFile = if ($project.Python) { Join-Path $projectDir '.venv/Scripts/python.exe' } elseif ($project.Name -eq 'dashboard' -and $DashboardDev) { Join-Path $projectDir 'node_modules/next/dist/bin/next' } elseif ($project.Name -eq 'dashboard') { Join-Path $projectDir '.next/BUILD_ID' } else { Join-Path $projectDir 'dist/main.js' }
  if (-not (Test-Path -LiteralPath $requiredFile)) { throw "Missing build or runtime for $($project.Name); install dependencies and build before starting." }
}
$started = @()
foreach ($project in $projects) {
  $projectDir = Join-Path $workspaceRoot $project.Folder
  $listener = Get-NetTCPConnection -LocalPort $project.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    if (-not $Restart) { Write-Host "$($project.Name): already listening on $($project.Port)"; continue }
    if (-not (Test-ProjectProcess -ProcessId $listener.OwningProcess -ProjectDirectory $projectDir -Python $project.Python)) {
      throw "Port $($project.Port) is occupied by a process outside this project's launcher; no process was stopped."
    }
    Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
  }
  if ($project.Python) {
    $executable = Join-Path $projectDir '.venv/Scripts/python.exe'
    $arguments = @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',[string]$project.Port,'--env-file','.env.local')
  } elseif ($project.Name -eq 'dashboard') {
    if (-not $DashboardDev -and -not (Test-Path -LiteralPath (Join-Path $projectDir '.next/BUILD_ID'))) {
      throw 'Dashboard production build is missing. Run npm run build in dashboard-osint before starting the stack.'
    }
    $executable = $nodePath
    $nextMode = if ($DashboardDev) { 'dev' } else { 'start' }
    $arguments = @((Join-Path $projectDir 'node_modules/next/dist/bin/next'),$nextMode,'-p','3003','-H','127.0.0.1')
  } else {
    $executable = $nodePath
    $arguments = @((Join-Path $projectDir 'dist/main.js'))
  }
  if (-not (Test-Path -LiteralPath $executable)) { throw "Missing executable for $($project.Name); install dependencies first." }
  $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtimeDir "$($project.Name).log") -RedirectStandardError (Join-Path $runtimeDir "$($project.Name).error.log")
  $started += [pscustomobject]@{ Name=$project.Name; Port=$project.Port; ProcessId=$process.Id }
  Write-Host "$($project.Name): started PID $($process.Id), port $($project.Port)"
}
$running = foreach ($project in @(
  @{ Name='face-biometric'; Port=7120 }, @{ Name='visual-context'; Port=7130 },
  @{ Name='social-scraper'; Port=7110 }, @{ Name='osint-core'; Port=7105 }, @{ Name='dashboard'; Port=3003 }
)) {
  $listener = Get-NetTCPConnection -LocalPort $project.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $newProcess = $started | Where-Object { $_.Name -eq $project.Name } | Select-Object -First 1
  if ($newProcess) { $newProcess } elseif ($listener) { [pscustomobject]@{ Name=$project.Name; Port=$project.Port; ProcessId=$listener.OwningProcess } }
}
$running | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'processes.json') -Encoding utf8
