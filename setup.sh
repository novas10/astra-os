#!/usr/bin/env bash
# AstraOS v4.0 — One-Click Setup Script (macOS / Linux)
# Usage: bash setup.sh
set -euo pipefail

# ─── Colors ───
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'
MAGENTA='\033[0;35m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${RESET} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${RESET} $1"; }
fail() { echo -e "  ${RED}[XX]${RESET} $1"; }
step() { echo -e "\n${CYAN}${BOLD}[$1/$2]${RESET} ${BOLD}$3${RESET}\n  ──────────────────────────────────────────────"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${MAGENTA}${BOLD}  =========================================${RESET}"
echo -e "${MAGENTA}${BOLD}       AstraOS v4.0 Setup Installer        ${RESET}"
echo -e "${MAGENTA}${BOLD}  =========================================${RESET}"
echo -e "${DIM}  Tip: For an interactive wizard, run: npx astra-os${RESET}"
echo ""

TOTAL=7

# ─── Step 1: Check Node.js ───
step 1 $TOTAL "Checking Node.js"
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -lt 18 ]; then
        fail "Node.js $NODE_VER is too old. AstraOS requires Node >= 18."
        echo -e "  Install via: ${BOLD}nvm install 20${RESET} or ${BOLD}brew install node@20${RESET}"
        exit 1
    fi
    ok "Node.js $NODE_VER"
else
    fail "Node.js not found."
    echo -e "  Install via: ${BOLD}nvm install 20${RESET} or ${BOLD}brew install node@20${RESET}"
    echo -e "  Or visit: https://nodejs.org"
    exit 1
fi

# ─── Step 2: Check Git ───
step 2 $TOTAL "Checking Git"
if command -v git &>/dev/null; then
    GIT_VER=$(git --version | sed 's/git version //')
    ok "Git $GIT_VER"
else
    warn "Git not found — not required but recommended"
fi

# ─── Step 3: Setup .env ───
step 3 $TOTAL "Setting up environment config"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

if [ -f "$ENV_FILE" ]; then
    ok ".env already exists — keeping your existing config"
elif [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env created from .env.example"

    # Auto-generate secrets
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)
    MASTER_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s/JWT_SECRET=your-jwt-secret/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
        sed -i '' "s/MASTER_ENCRYPTION_KEY=your-64-char-hex-key-for-aes256gcm/MASTER_ENCRYPTION_KEY=$MASTER_KEY/" "$ENV_FILE"
    else
        sed -i "s/JWT_SECRET=your-jwt-secret/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
        sed -i "s/MASTER_ENCRYPTION_KEY=your-64-char-hex-key-for-aes256gcm/MASTER_ENCRYPTION_KEY=$MASTER_KEY/" "$ENV_FILE"
    fi
    ok "Auto-generated JWT_SECRET"
    ok "Auto-generated MASTER_ENCRYPTION_KEY"
    warn "IMPORTANT: Edit .env and add your ANTHROPIC_API_KEY before starting!"
else
    fail ".env.example not found. Are you in the AstraOS directory?"
    exit 1
fi

# ─── Step 4: Install backend dependencies ───
step 4 $TOTAL "Installing backend dependencies"
npm install --legacy-peer-deps 2>&1 | tail -1 || npm install 2>&1 | tail -1
ok "Backend dependencies installed"

# ─── Step 5: Install dashboard dependencies ───
step 5 $TOTAL "Installing dashboard dependencies"
DASH_DIR="$SCRIPT_DIR/packages/dashboard"
if [ -d "$DASH_DIR" ]; then
    (cd "$DASH_DIR" && npm install --legacy-peer-deps 2>&1 | tail -1 || npm install 2>&1 | tail -1)
    ok "Dashboard dependencies installed"
else
    warn "Dashboard directory not found — skipping"
fi

# ─── Step 6: Build ───
step 6 $TOTAL "Building AstraOS"
echo -e "  Building backend..."
npm run build 2>&1 | tail -3
ok "Backend built"

if [ -d "$DASH_DIR" ]; then
    echo -e "  Building dashboard..."
    npm run dashboard:build 2>&1 | tail -3 || warn "Dashboard build had issues"

    # Copy dashboard to public/ for production serving
    DASH_DIST="$DASH_DIR/dist"
    PUBLIC_DIR="$SCRIPT_DIR/public"
    if [ -d "$DASH_DIST" ]; then
        cp -r "$DASH_DIST/." "$PUBLIC_DIR/"
        ok "Dashboard built and copied to public/"
    fi
fi

# ─── Step 7: Done! ───
step 7 $TOTAL "Setup Complete!"

echo ""
echo -e "${GREEN}${BOLD}  =========================================${RESET}"
echo -e "${GREEN}${BOLD}       AstraOS v4.0 is ready!              ${RESET}"
echo -e "${GREEN}${BOLD}  =========================================${RESET}"
echo ""
echo -e "  ${CYAN}Start AstraOS:${RESET}"
echo -e "    ${BOLD}npm start${RESET}         — production"
echo -e "    ${BOLD}npm run dev${RESET}       — development with reload"
echo ""
echo -e "  ${CYAN}Open in browser:${RESET}"
echo -e "    Dashboard : ${BOLD}http://localhost:3000${RESET}"
echo -e "    API Docs  : ${BOLD}http://localhost:3000/docs${RESET}"
echo -e "    Health    : ${BOLD}http://localhost:3000/health${RESET}"
echo ""
echo -e "  ${CYAN}Cloud Deploy:${RESET}"
echo -e "    Railway : ${DIM}railway init && railway up${RESET}"
echo -e "    Render  : ${DIM}Push to GitHub, connect on render.com${RESET}"
echo -e "    Docker  : ${DIM}docker compose up -d${RESET}"
echo ""

# Check if API key is set
if grep -q "ANTHROPIC_API_KEY=sk-ant-\.\.\." "$ENV_FILE" 2>/dev/null; then
    warn "Add your ANTHROPIC_API_KEY in .env before starting!"
    echo -e "  Run: ${BOLD}nano .env${RESET}"
    echo ""
fi

echo -e "  Run ${BOLD}npm start${RESET} to launch AstraOS!"
echo ""
