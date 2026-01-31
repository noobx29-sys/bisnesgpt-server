#!/bin/bash

# PM2 Auto-Start Setup Script
# This script ensures PM2 starts automatically on system boot

echo "🚀 Setting up PM2 auto-start configuration..."

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2 not found. Installing PM2..."
    npm install -g pm2
fi

# Stop all PM2 processes first
echo "⏸️  Stopping all PM2 processes..."
pm2 stop all

# Start server.js
echo "▶️  Starting server.js..."
pm2 start server.js

# Save PM2 process list
echo "💾 Saving PM2 process list..."
pm2 save

# Setup PM2 startup script
echo "🔧 Setting up PM2 startup configuration..."
pm2 startup

echo ""
echo "⚠️  IMPORTANT: If you see a command above starting with 'sudo', you MUST run it manually!"
echo "    Copy and paste that sudo command and run it in your terminal."
echo ""
echo "After running the sudo command (if shown above), run:"
echo "    pm2 save"
echo ""
echo "✅ Setup complete! PM2 will now start automatically on system boot."
echo ""
echo "To test, you can:"
echo "  1. Restart your system"
echo "  2. After reboot, check: pm2 list"
echo "  3. Your server.js should be running automatically!"
