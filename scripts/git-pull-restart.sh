#!/bin/bash

echo "⬇️ Git pull and restart..."

# Pull from master
echo "📥 Pulling from master..."
git pull origin master

# Check if package.json changed
if git diff HEAD@{1} HEAD -- package.json | grep -q .; then
    echo "📦 package.json changed, running npm install..."
    npm install
fi

# Stop server.js
echo "⏸️  Stopping server.js..."
pm2 stop server.js

# Kill Chrome processes
echo "❌ Killing Chrome processes..."
pkill -9 chrome || pkill -9 Chrome || killall -9 "Google Chrome" || true

# Wait for cleanup
sleep 2

# Start server.js
echo "▶️  Starting server.js..."
pm2 start server.js

echo "✅ Git pull and restart completed"
