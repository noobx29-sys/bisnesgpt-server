#!/bin/bash

echo "⏸️  Stopping server..."
pm2 stop server.js
echo "✅ Server stopped"
