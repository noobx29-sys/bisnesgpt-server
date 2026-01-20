# Contact Tagging - Quick Start Guide

## Installation (3 Steps)

### 1. Run Setup Script
```bash
./setup-tagging.sh
```

### 2. Test It Out
```bash
# Replace with your actual company ID and contact ID
node tagCLI.js test YOUR_COMPANY_ID +60123456789
```

### 3. Tag Your Contacts
```bash
# Tag all contacts (dry run first)
node tagCLI.js tag-all YOUR_COMPANY_ID 10 --dry-run

# If it looks good, run for real
node tagCLI.js tag-all YOUR_COMPANY_ID
```

---

## Common Commands

```bash
# Tag one contact
node tagCLI.js tag-one <companyId> <contactId>

# Tag all contacts
node tagCLI.js tag-all <companyId>

# Test without saving
node tagCLI.js test <companyId> <contactId>

# View statistics
node tagCLI.js stats <companyId>

# List all tags
node tagCLI.js list-tags

# Get help
node tagCLI.js help
```

---

## Add to Your Server

In `server.js`, add:

```javascript
// Import the routes
const contactTaggingRoutes = require('./routes/contactTagging');

// Add the routes (after other route definitions)
app.use('/api/tags', contactTaggingRoutes);
```

Then restart your server.

---

## API Examples

### Tag a contact
```bash
curl -X POST http://localhost:3000/api/tags/contact/+60123456789 \
  -H "Content-Type: application/json" \
  -d '{"companyId": "YOUR_COMPANY_ID"}'
```

### Get analytics
```bash
curl "http://localhost:3000/api/tags/analytics?companyId=YOUR_COMPANY_ID"
```

### Search contacts
```bash
curl "http://localhost:3000/api/tags/search?companyId=YOUR_COMPANY_ID&tags=hot-lead,query"
```

---

## What Tags Mean

### 🟢 Good Signs
- `hot-lead` - Very engaged, responds quickly
- `interested` - Showing buying signals
- `active` - Currently in conversation
- `quick-responder` - Responds within an hour

### 🟡 Needs Attention
- `query` - Has unanswered questions
- `follow-up-needed` - You should reach out
- `needs-attention` - Urgent or complaint
- `warm-lead` - Somewhat engaged

### 🔴 Not Engaged
- `cold-lead` - Not responding
- `cold` - Multiple unanswered messages
- `dormant` - No activity in 30+ days
- `not-interested` - Expressed disinterest

### ℹ️ Informational
- `new` - Brand new contact
- `closed` - Conversation completed
- `vip` - High priority (manual)
- `weekend-active` - Active on weekends
- `night-owl` - Active at night
- `business-hours` - Active 9-5

---

## Customize Tags

Edit `tagConfig.js`:

```javascript
// Change when a contact is considered dormant (default: 30 days)
DEFAULT_TAGS.dormant.rules.daysSinceLastMessage = { min: 60 };

// Add more interest keywords
KEYWORDS.interest.push('demo', 'trial', 'pricing');

// Disable AI to save costs
ANALYSIS_CONFIG.enableAI = false;
```

---

## Automation Ideas

### 1. Tag on New Messages
```javascript
// In your message handler
const { ContactTagger } = require('./contactTagger');

async function onNewMessage(message, contactId, companyId) {
  // ... handle message ...

  // Auto-tag (don't wait)
  new ContactTagger(companyId).tagContact(contactId);
}
```

### 2. Daily Re-tagging (Cron)
```javascript
const cron = require('node-cron');

// Every day at 2 AM
cron.schedule('0 2 * * *', async () => {
  const companies = await getCompanies();
  for (const company of companies) {
    await new ContactTagger(company.id).tagAllContacts();
  }
});
```

### 3. Alert on Important Tags
```javascript
const result = await tagger.tagContact(contactId);

if (result.tags.toAdd.includes('needs-attention')) {
  await sendAlert(`Contact ${contactId} needs attention!`);
}

if (result.tags.toAdd.includes('hot-lead')) {
  await notifySalesTeam(contactId);
}
```

---

## Cost Estimates

**Using AI (GPT-4o-mini):**
- 1,000 contacts: ~$0.06
- 10,000 contacts: ~$0.60
- Daily updates (30k contacts): ~$54/month

**Without AI (rules only):**
- Free! Just database queries

---

## Troubleshooting

**No tags applied?**
```bash
# Check with verbose output
node tagCLI.js test <companyId> <contactId> --verbose
```

**AI not working?**
```bash
# Check if API key is set
echo $OPENAI_API_KEY

# Try without AI
node tagCLI.js tag-one <companyId> <contactId> --no-ai
```

**Too slow?**
```javascript
// In tagConfig.js, reduce limits
ANALYSIS_CONFIG.messageLimit = 20;  // Analyze fewer messages
ANALYSIS_CONFIG.enableAI = false;    // Disable AI
```

---

## Files You Got

- `contactTagger.js` - Main engine
- `tagConfig.js` - Tag definitions & rules
- `tagCLI.js` - Command-line tool
- `routes/contactTagging.js` - API routes
- `migrations/001_contact_tagging_tables.sql` - Database setup
- `CONTACT_TAGGING_README.md` - Full documentation
- `TAGGING_QUICK_START.md` - This file
- `setup-tagging.sh` - Setup script

---

## Next Steps

1. ✅ Run `./setup-tagging.sh`
2. ✅ Test with `node tagCLI.js test <companyId> <contactId>`
3. ✅ Review tags with `node tagCLI.js list-tags`
4. ✅ Customize rules in `tagConfig.js` if needed
5. ✅ Tag your contacts: `node tagCLI.js tag-all <companyId>`
6. ✅ Add routes to `server.js`
7. ✅ Set up automation (optional)

**Read the full docs:** `CONTACT_TAGGING_README.md`

---

**Questions?** Check the main README or review the code comments.
