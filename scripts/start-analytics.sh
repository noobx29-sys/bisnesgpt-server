#!/bin/bash

# =====================================================
# Start Lead Analytics Server
# =====================================================

echo "🚀 Starting Lead Analytics Server..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create a .env file with your database credentials"
    exit 1
fi

# Set analytics port (default 3001)
export ANALYTICS_PORT=${ANALYTICS_PORT:-3001}

# Start the server
node analytics-server.js
