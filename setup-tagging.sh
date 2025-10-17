#!/bin/bash

# =====================================================
# Contact Tagging System - Setup Script
# =====================================================

echo "=========================================="
echo "Contact Tagging System - Setup"
echo "=========================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable not set"
    echo "Please set DATABASE_URL in your .env file"
    exit 1
fi

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  Warning: OPENAI_API_KEY not set"
    echo "AI features will not work without this key"
    echo "You can still use rule-based tagging"
    echo ""
    read -p "Continue without AI? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run database migration
echo "📊 Running database migration..."
psql $DATABASE_URL -f migrations/001_contact_tagging_tables.sql

if [ $? -eq 0 ]; then
    echo "✅ Database tables created successfully"
else
    echo "❌ Database migration failed"
    exit 1
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Test with a single contact:"
echo "   node tagCLI.js test <companyId> <contactId>"
echo ""
echo "2. View available tags:"
echo "   node tagCLI.js list-tags"
echo ""
echo "3. Tag all contacts:"
echo "   node tagCLI.js tag-all <companyId>"
echo ""
echo "4. Add API routes to server.js:"
echo "   const contactTaggingRoutes = require('./routes/contactTagging');"
echo "   app.use('/api/tags', contactTaggingRoutes);"
echo ""
echo "📖 See CONTACT_TAGGING_README.md for full documentation"
echo ""
