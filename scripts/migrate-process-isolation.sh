#!/bin/bash

# Migration Script for Process Isolation
# This script helps migrate from single-process to multi-process architecture

set -e  # Exit on error

echo "=========================================="
echo "Process Isolation Migration"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if PostgreSQL is available
echo "Checking database connection..."
if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to database${NC}"
    echo "Please ensure DATABASE_URL is set correctly"
    exit 1
fi
echo -e "${GREEN}✅ Database connection OK${NC}"
echo ""

# Run database migration
echo "Running database migration..."
if psql "$DATABASE_URL" -f migrations/process_isolation.sql; then
    echo -e "${GREEN}✅ Database migration completed${NC}"
else
    echo -e "${RED}❌ Database migration failed${NC}"
    exit 1
fi
echo ""

# Check Redis connection
echo "Checking Redis connection..."
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis connection OK${NC}"
else
    echo -e "${YELLOW}⚠️  Redis not available - message queue may not work${NC}"
    echo "Install Redis: brew install redis (macOS) or apt-get install redis-server (Ubuntu)"
fi
echo ""

# Check if PM2 is installed
echo "Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}⚠️  PM2 not installed${NC}"
    echo "Installing PM2..."
    npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
else
    echo -e "${GREEN}✅ PM2 already installed${NC}"
fi
echo ""

# Install dependencies
echo "Installing Node dependencies..."
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Create logs directory
echo "Creating logs directory..."
mkdir -p logs
echo -e "${GREEN}✅ Logs directory created${NC}"
echo ""

# Backup current PM2 processes
echo "Backing up current PM2 configuration..."
pm2 save --force || echo "No existing PM2 processes to backup"
echo ""

# Display next steps
echo "=========================================="
echo "Migration Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Review and update .env file with new variables:"
echo "   - API_PORT=3000"
echo "   - WWEBJS_PORT=3001"
echo "   - META_PORT=3002"
echo "   - REDIS_HOST=localhost"
echo "   - REDIS_PORT=6379"
echo "   - ENABLE_WWEBJS=true"
echo "   - ENABLE_META=true"
echo ""
echo "2. Test in development mode:"
echo "   ${GREEN}npm run dev${NC}"
echo ""
echo "3. Or start with orchestrator:"
echo "   ${GREEN}node server-orchestrator.js${NC}"
echo ""
echo "4. Or start with PM2:"
echo "   ${GREEN}pm2 start ecosystem.config.js${NC}"
echo ""
echo "5. Check process status:"
echo "   ${GREEN}pm2 status${NC}"
echo "   ${GREEN}pm2 logs${NC}"
echo ""
echo "6. View health status:"
echo "   ${GREEN}curl http://localhost:3000/health${NC}"
echo "   ${GREEN}curl http://localhost:3000/health/all${NC}"
echo ""
echo "=========================================="
