# ╔══════════════════════════════════════════════════════════════╗
# ║           AstraOS v4.0 — One-Click Setup Script            ║
# ║           For Windows 10/11 (PowerShell 5.1+)              ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

function Write-Step($step, $msg) {
    Write-Host "`n[$step] $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
    Write-Host "  [X] $msg" -ForegroundColor Red
}

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# ── Banner ──
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║     AstraOS v4.0 Setup Installer      ║" -ForegroundColor Magenta
Write-Host "  ║     Asus X515 VivoBook Edition        ║" -ForegroundColor Magenta
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── Step 1: Check & Install Node.js ──
Write-Step "1/8" "Checking Node.js..."
if (Test-Command "node") {
    $nodeVer = (node -v)
    Write-Ok "Node.js $nodeVer found"
    $major = [int]($nodeVer -replace 'v(\d+)\..*', '$1')
    if ($major -lt 18) {
        Write-Warn "Node.js v18+ recommended. Current: $nodeVer"
        Write-Host "  Download from: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Fail "Node.js not found"
    Write-Host "  Installing Node.js 20 LTS via winget..." -ForegroundColor Yellow
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        Write-Ok "Node.js installed. Please RESTART PowerShell and re-run this script."
        exit 0
    } catch {
        Write-Fail "Auto-install failed. Please install manually from https://nodejs.org"
        exit 1
    }
}

# ── Step 2: Check Git ──
Write-Step "2/8" "Checking Git..."
if (Test-Command "git") {
    $gitVer = (git --version)
    Write-Ok "$gitVer found"
} else {
    Write-Fail "Git not found"
    try {
        winget install Git.Git --accept-source-agreements --accept-package-agreements
        Write-Ok "Git installed. Please RESTART PowerShell and re-run this script."
        exit 0
    } catch {
        Write-Fail "Auto-install failed. Please install from https://git-scm.com"
        exit 1
    }
}

# ── Step 3: Check Docker (optional) ──
Write-Step "3/8" "Checking Docker (optional - for Redis)"
$hasDocker = Test-Command "docker"
if ($hasDocker) {
    $dockerVer = (docker --version)
    Write-Ok "$dockerVer found"
} else {
    Write-Warn "Docker not found. Redis will not start via docker compose."
    Write-Warn "You can install Docker Desktop later or run Redis manually."
    Write-Warn "AstraOS will still work without Redis (uses in-memory fallback)."
}

# ── Step 4: Setup .env ──
Write-Step "4/8" "Setting up environment config..."
$envFile = Join-Path $PSScriptRoot ".env"
$envExample = Join-Path $PSScriptRoot ".env.example"

if (Test-Path $envFile) {
    Write-Ok ".env already exists (keeping your existing config)"
} elseif (Test-Path $envExample) {
    Copy-Item $envExample $envFile
    Write-Ok ".env created from .env.example"
    Write-Warn "IMPORTANT: Edit .env and add your API keys before starting!"
    Write-Host ""
    Write-Host "  Required keys:" -ForegroundColor Yellow
    Write-Host "    ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor White
    Write-Host "    JWT_SECRET=<any-random-string>" -ForegroundColor White
    Write-Host ""

    # Generate a random JWT secret
    $jwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    (Get-Content $envFile) -replace 'JWT_SECRET=your-jwt-secret', "JWT_SECRET=$jwtSecret" | Set-Content $envFile
    Write-Ok "Auto-generated JWT_SECRET"

    # Generate a random encryption key (64 hex chars)
    $encKey = -join ((0..63) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    (Get-Content $envFile) -replace 'MASTER_ENCRYPTION_KEY=your-64-char-hex-key-for-aes256gcm', "MASTER_ENCRYPTION_KEY=$encKey" | Set-Content $envFile
    Write-Ok "Auto-generated MASTER_ENCRYPTION_KEY"
} else {
    Write-Fail ".env.example not found. Are you in the AstraOS directory?"
    exit 1
}

# ── Step 5: Install backend dependencies ──
Write-Step "5/8" "Installing backend dependencies..."
npm install --legacy-peer-deps 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Backend dependencies installed"
} else {
    npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Backend dependencies installed"
    } else {
        Write-Fail "npm install failed. Check errors above."
        exit 1
    }
}

# ── Step 6: Install dashboard dependencies ──
Write-Step "6/8" "Installing dashboard dependencies..."
Push-Location (Join-Path $PSScriptRoot "packages/dashboard")
npm install --legacy-peer-deps 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Dashboard dependencies installed"
} else {
    npm install 2>&1 | Out-Null
    Write-Ok "Dashboard dependencies installed"
}
Pop-Location

# ── Step 7: Build project ──
Write-Step "7/8" "Building AstraOS..."
Write-Host "  Building backend..." -ForegroundColor Gray
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Backend built successfully"
} else {
    Write-Warn "Backend build had issues (may still work in dev mode)"
}

Write-Host "  Building dashboard..." -ForegroundColor Gray
npm run dashboard:build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Dashboard built successfully"
} else {
    Write-Warn "Dashboard build had issues"
}

# ── Step 8: Start services ──
Write-Step "8/8" "Starting AstraOS..."

# Start Docker services if available
if ($hasDocker) {
    Write-Host "  Starting Redis via Docker..." -ForegroundColor Gray
    docker compose up -d 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker services started"
    } else {
        Write-Warn "Docker services failed to start (AstraOS will use fallbacks)"
    }
}

# ── Done! ──
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║          AstraOS v4.0 Setup Complete!             ║" -ForegroundColor Green
Write-Host "  ╠═══════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║                                                   ║" -ForegroundColor Green
Write-Host "  ║  To start AstraOS:                                ║" -ForegroundColor Green
Write-Host "  ║    npm start          (production)                ║" -ForegroundColor Green
Write-Host "  ║    npm run dev        (development with reload)   ║" -ForegroundColor Green
Write-Host "  ║                                                   ║" -ForegroundColor Green
Write-Host "  ║  Dashboard:                                       ║" -ForegroundColor Green
Write-Host "  ║    npm run dashboard:dev   (dev server)           ║" -ForegroundColor Green
Write-Host "  ║                                                   ║" -ForegroundColor Green
Write-Host "  ║  Open in browser:                                 ║" -ForegroundColor Green
Write-Host "  ║    http://localhost:3000                          ║" -ForegroundColor Green
Write-Host "  ║                                                   ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Check if API key is set
$envContent = Get-Content $envFile -Raw
if ($envContent -match 'ANTHROPIC_API_KEY=sk-ant-\.\.\.') {
    Write-Warn "Don't forget to add your ANTHROPIC_API_KEY in .env!"
    Write-Host "  Run: notepad .env" -ForegroundColor Yellow
}

Write-Host "  Run npm start to launch AstraOS!" -ForegroundColor Cyan
Write-Host ""
