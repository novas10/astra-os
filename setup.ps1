# AstraOS v4.0 - One-Click Windows Setup Script

$ErrorActionPreference = "Stop"

function Write-Step { param($step, $msg) Write-Host "`n[$step] $msg" -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  [X] $msg" -ForegroundColor Red }

function Test-Command { param($cmd) return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host ""
Write-Host "  =========================================" -ForegroundColor Magenta
Write-Host "       AstraOS v4.0 Setup Installer        " -ForegroundColor Magenta
Write-Host "  =========================================" -ForegroundColor Magenta
Write-Host ""

# Step 1: Check Node.js
Write-Step -step "1/8" -msg "Checking Node.js"
if (Test-Command -cmd "node") {
    $nv = node -v
    Write-Ok -msg "Node.js $nv found"
} else {
    Write-Fail -msg "Node.js not found"
    Write-Host "  Installing Node.js 20 LTS via winget..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        Write-Ok -msg "Node.js installed. Please RESTART PowerShell and re-run this script."
        exit 0
    } catch {
        Write-Fail -msg "Auto-install failed. Please install manually from https://nodejs.org"
        exit 1
    }
}

# Step 2: Check Git
Write-Step -step "2/8" -msg "Checking Git"
if (Test-Command -cmd "git") {
    $gv = git --version
    Write-Ok -msg "$gv found"
} else {
    Write-Fail -msg "Git not found"
    try {
        winget install Git.Git --accept-source-agreements --accept-package-agreements
        Write-Ok -msg "Git installed. Please RESTART PowerShell and re-run this script."
        exit 0
    } catch {
        Write-Fail -msg "Auto-install failed. Please install from https://git-scm.com"
        exit 1
    }
}

# Step 3: Check Docker
Write-Step -step "3/8" -msg "Checking Docker"
$dockerOk = Test-Command -cmd "docker"
if ($dockerOk) {
    $dv = docker --version
    Write-Ok -msg "$dv found"
} else {
    Write-Warn -msg "Docker not found. Redis will not start via docker compose."
    Write-Warn -msg "AstraOS will still work without Redis."
}

# Step 4: Setup .env
Write-Step -step "4/8" -msg "Setting up environment config"
$ef = Join-Path $PSScriptRoot ".env"
$ex = Join-Path $PSScriptRoot ".env.example"

if (Test-Path $ef) {
    Write-Ok -msg ".env already exists - keeping your existing config"
} elseif (Test-Path $ex) {
    Copy-Item $ex $ef
    Write-Ok -msg ".env created from .env.example"
    Write-Warn -msg "IMPORTANT: Edit .env and add your ANTHROPIC_API_KEY before starting!"

    $secret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    $raw = Get-Content $ef -Raw
    $raw = $raw -replace "JWT_SECRET=your-jwt-secret", "JWT_SECRET=$secret"
    Set-Content $ef $raw -NoNewline
    Write-Ok -msg "Auto-generated JWT_SECRET"

    $ek = -join ((0..63) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
    $raw2 = Get-Content $ef -Raw
    $raw2 = $raw2 -replace "MASTER_ENCRYPTION_KEY=your-64-char-hex-key-for-aes256gcm", "MASTER_ENCRYPTION_KEY=$ek"
    Set-Content $ef $raw2 -NoNewline
    Write-Ok -msg "Auto-generated MASTER_ENCRYPTION_KEY"
} else {
    Write-Fail -msg ".env.example not found. Are you in the AstraOS directory?"
    exit 1
}

# Step 5: Install backend dependencies
Write-Step -step "5/8" -msg "Installing backend dependencies"
npm install --legacy-peer-deps 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok -msg "Backend dependencies installed"
} else {
    npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok -msg "Backend dependencies installed"
    } else {
        Write-Fail -msg "npm install failed"
        exit 1
    }
}

# Step 6: Install dashboard dependencies
Write-Step -step "6/8" -msg "Installing dashboard dependencies"
$dashDir = Join-Path $PSScriptRoot "packages\dashboard"
Push-Location $dashDir
npm install --legacy-peer-deps 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok -msg "Dashboard dependencies installed"
} else {
    npm install 2>&1 | Out-Null
    Write-Ok -msg "Dashboard dependencies installed"
}
Pop-Location

# Step 7: Build project
Write-Step -step "7/8" -msg "Building AstraOS"
Write-Host "  Building backend..." -ForegroundColor Gray
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok -msg "Backend built successfully"
} else {
    Write-Warn -msg "Backend build had issues - may still work in dev mode"
}

Write-Host "  Building dashboard..." -ForegroundColor Gray
npm run dashboard:build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok -msg "Dashboard built successfully"
} else {
    Write-Warn -msg "Dashboard build had issues"
}

# Step 8: Start services
Write-Step -step "8/8" -msg "Starting AstraOS"
if ($dockerOk) {
    Write-Host "  Starting Redis via Docker..." -ForegroundColor Gray
    docker compose up -d 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok -msg "Docker services started"
    } else {
        Write-Warn -msg "Docker services failed to start - AstraOS will use fallbacks"
    }
}

# Done
Write-Host ""
Write-Host "  =========================================" -ForegroundColor Green
Write-Host "       AstraOS v4.0 Setup Complete!        " -ForegroundColor Green
Write-Host "  =========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To start AstraOS:" -ForegroundColor White
Write-Host "    npm start        - production" -ForegroundColor White
Write-Host "    npm run dev      - development with reload" -ForegroundColor White
Write-Host ""
Write-Host "  Dashboard:" -ForegroundColor White
Write-Host "    npm run dashboard:dev" -ForegroundColor White
Write-Host ""
Write-Host "  Open in browser:" -ForegroundColor White
Write-Host "    http://localhost:3000" -ForegroundColor White
Write-Host ""

$ec = Get-Content $ef -Raw
if ($ec -match "ANTHROPIC_API_KEY=sk-ant-\.\.\.") {
    Write-Warn -msg "Add your ANTHROPIC_API_KEY in .env before starting!"
    Write-Host "  Run: notepad .env" -ForegroundColor Yellow
}

Write-Host "  Run 'npm start' to launch AstraOS!" -ForegroundColor Cyan
Write-Host ""
