#!/bin/bash
set -euo pipefail

# BlackBox AI — One-click Startup Script
# Starts both the FastAPI backend and TanStack Start frontend

# Color helper functions
info() { echo -e "\033[1;34m[INFO]\033[0m $1"; }
success() { echo -e "\033[1;32m[SUCCESS]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $1"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $1"; }

# Handle script exit / Ctrl+C gracefully
cleanup() {
    echo ""
    info "Shutting down servers..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    success "BlackBox AI stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

# Root workspace directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

command -v python3 >/dev/null 2>&1 || { error "python3 is required but not installed."; exit 1; }
command -v npm >/dev/null 2>&1 || { error "npm is required but not installed."; exit 1; }

# 1. Setup/Validate Python Backend
info "Setting up Python backend environment..."
cd "$ROOT_DIR/backend"

if [ ! -d ".venv" ]; then
    warn "Python virtual environment (.venv) not found. Creating one..."
    python3 -m venv .venv
fi

source .venv/bin/activate

info "Installing/updating Python dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
success "Backend setup complete."

# 2. Setup/Validate Node Frontend
info "Setting up frontend environment..."
cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
    warn "node_modules not found. Installing node dependencies..."
    npm install
fi
success "Frontend setup complete."

# 3. Check/Create Environment Variables
if [ ! -f "backend/.env" ]; then
    warn "backend/.env file not found. Initializing with .env.example..."
    cp backend/.env.example backend/.env
fi

if ! grep -Eq '^GEMINI_API_KEY="?.+"?$' backend/.env || grep -Eq 'your-gemini-key-here|replace-me|changeme' backend/.env; then
    warn "Gemini API key is not configured. BlackBox AI will start in offline demo mode with seeded investigations and mock model responses."
fi

# 4. Start Backend Server
info "Starting FastAPI Backend on port 8000..."
cd "$ROOT_DIR"
source backend/.venv/bin/activate
PYTHONPATH=. uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 > "$ROOT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!


# 5. Start Frontend Server
info "Starting TanStack Start Frontend..."
cd "$ROOT_DIR"
npm run dev > "$ROOT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

success "Both servers are launching!"
info "=================================================="
info "  Frontend: http://localhost:3000 (or terminal output)"
info "  Backend API Docs: http://localhost:8000/docs"
info "  Mode: Live Gemini if backend/.env has a real API key; otherwise offline demo mode"
info "=================================================="
info "Streaming backend logs in real-time below. Press Ctrl+C to exit."
echo ""

# Monitor backend logs in foreground (since that's usually where trace info flows)
tail -f "$ROOT_DIR/backend.log"
