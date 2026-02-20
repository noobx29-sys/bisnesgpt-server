#!/bin/bash

# Startup script for multi-process architecture
set -e

echo "=========================================="
echo "Starting BisnessGPT Multi-Process Server"
echo "=========================================="

# Check PM2
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not installed. Install with: npm install -g pm2"
    exit 1
fi

# Load environment
if [ -f .env ]; then
    set -a
    source <(grep -v '^\s*#' .env | grep -v '^\s*$' | sed 's/[[:space:]]*=[[:space:]]*/=/')
    set +a
fi

# Choose mode
if [ "$1" == "--orchestrator" ]; then
    echo "Starting in orchestrator mode..."
    node server-orchestrator.js
else
    echo "Starting with PM2..."
    
    # Stop old processes
    pm2 delete bisnesgpt-api bisnesgpt-wwebjs bisnesgpt-meta 2>/dev/null || true
    
    # Start processes
    pm2 start ecosystem.config.js --only bisnesgpt-api,bisnesgpt-wwebjs,bisnesgpt-meta
    
    # Save config
    pm2 save --force
    
    echo ""
    pm2 status
    echo ""
    echo "Health Check: curl http://localhost:3000/health/all"
fi
