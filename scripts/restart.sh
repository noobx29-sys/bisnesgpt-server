#!/bin/bash

echo "🔄 Restarting server..."

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

echo "✅ Server restarted successfully"
