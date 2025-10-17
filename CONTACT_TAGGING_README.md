# Contact Tagging System

Automatically categorize and tag your WhatsApp contacts based on their message behavior, engagement patterns, and AI-powered sentiment analysis.

## Overview

This system analyzes conversations and automatically assigns tags like `hot-lead`, `query`, `dormant`, `needs-attention`, etc. to help you organize and prioritize your contacts.

**Key Features:**
- 🤖 AI-powered classification using GPT-4o-mini (cost-effective)
- 📊 20+ built-in tags across 4 categories
- ⚡ Batch processing for thousands of contacts
- 📈 Real-time analytics and reporting
- 🔄 Automatic tag updates based on conversation changes
- 💰 Cost-optimized (uses cheap AI model)

---

## Quick Start

### 1. Database Setup

Run the migration to create required tables:

```bash
psql $DATABASE_URL -f migrations/001_contact_tagging_tables.sql
```

This creates:
- `tag_definitions` - Tag configurations
- `contact_tag_history` - Audit trail
- `contact_tag_analytics` - Pre-computed stats
- `contact_tagging_queue` - Processing queue

### 2. Test with CLI

```bash
# Tag a single contact (dry run)
node tagCLI.js test <companyId> <contactId>

# Tag a single contact (save to database)
node tagCLI.js tag-one <companyId> <contactId> --verbose

# Tag all contacts for a company
node tagCLI.js tag-all <companyId>

# View statistics
node tagCLI.js stats <companyId>

# List all available tags
node tagCLI.js list-tags
```

### 3. Use the API

Add to your server.js:

```javascript
const contactTaggingRoutes = require('./routes/contactTagging');
app.use('/api/tags', contactTaggingRoutes);
```

Then use the endpoints:

```bash
# Tag a single contact
curl -X POST http://localhost:3000/api/tags/contact/+60123456789 \
  -H "Content-Type: application/json" \
  -d '{"companyId": "your-company-id"}'

# Get analytics
curl http://localhost:3000/api/tags/analytics?companyId=your-company-id

# Search by tags
curl "http://localhost:3000/api/tags/search?companyId=your-company-id&tags=hot-lead,query"
```

---

## Tag Categories

### 1. **Status Tags**
Indicate the current state of the conversation.

| Tag | Description | When Applied |
|-----|-------------|--------------|
| `new` | New contact | No messages yet, first day |
| `active` | Active conversation | Recent back-and-forth (<3 days) |
| `query` | Has questions | Last message contains questions |
| `closed` | Completed | Closing phrases detected, no follow-up |
| `dormant` | Inactive | No activity in 30+ days |
| `cold` | Unresponsive | 3+ unanswered outbound messages |

### 2. **Engagement Tags**
Measure the level of engagement.

| Tag | Description | When Applied |
|-----|-------------|--------------|
| `hot-lead` | High engagement | Fast responses (<1hr), positive signals |
| `warm-lead` | Moderate engagement | Responses within 24hrs |
| `cold-lead` | Low engagement | Slow responses (>48hrs) |
| `interested` | Buying signals | Keywords: price, cost, buy, etc. |
| `not-interested` | Rejection signals | Keywords: no thanks, not now, etc. |

### 3. **Behavioral Tags**
Identify behavioral patterns.

| Tag | Description | When Applied |
|-----|-------------|--------------|
| `quick-responder` | Fast responder | Avg response time <1hr |
| `slow-responder` | Slow responder | Avg response time >24hrs |
| `night-owl` | Night activity | 50%+ messages between 10PM-6AM |
| `business-hours` | Business hours | 70%+ messages between 9AM-5PM |
| `weekend-active` | Weekend activity | 40%+ messages on weekends |

### 4. **Action Tags**
Require immediate attention or action.

| Tag | Description | When Applied |
|-----|-------------|--------------|
| `follow-up-needed` | Needs follow-up | Unanswered question, 2-7 days old |
| `awaiting-response` | Waiting for reply | We sent last message <7 days ago |
| `needs-attention` | Manual review needed | Urgent keywords, complaints |
| `vip` | High priority | Manually assigned |

---

## How It Works

### Message Analysis Pipeline

```
1. Fetch Messages → 2. Calculate Metrics → 3. Apply Rules → 4. AI Analysis → 5. Update Tags
```

#### 1. **Fetch Messages**
- Retrieves last 50 messages per contact
- Sorted by timestamp (newest first)

#### 2. **Calculate Metrics**
- **Basic**: Message counts, last message sender
- **Time**: Days since last message, average response time
- **Behavioral**: Active hours, weekend activity
- **Engagement**: Message exchange rate, conversation balance
- **Content**: Keywords, questions, closing phrases

#### 3. **Apply Rules**
Each tag has rules that are evaluated against metrics:

```javascript
// Example: hot-lead tag rules
{
  averageResponseTime: { max: 3600 }, // <1 hour
  messageExchangeRate: { min: 0.8 },  // High back-and-forth
  positiveKeywords: ['interested', 'yes', ...]
}
```

#### 4. **AI Analysis** (GPT-4o-mini)
- **Sentiment**: positive / negative / neutral
- **Intent**: inquiry / purchase / support / complaint / feedback / general
- **Stage**: initial / ongoing / closing / closed / stalled

Only the last 10 messages are sent to AI to minimize costs.

#### 5. **Update Tags**
- Add new tags that match criteria
- Remove tags that no longer match
- Record all changes in audit history

---

## Configuration

### Customize Tag Rules

Edit `tagConfig.js`:

```javascript
// Modify existing tag rules
DEFAULT_TAGS.dormant.rules.daysSinceLastMessage = { min: 60 }; // Change to 60 days

// Add custom keywords
KEYWORDS.interest.push('demo', 'trial', 'sample');

// Toggle AI features
ANALYSIS_CONFIG.enableAI = true; // Enable/disable all AI
ANALYSIS_CONFIG.enableSentimentAnalysis = true;
ANALYSIS_CONFIG.enableIntentAnalysis = true;
```

### Adjust Processing Limits

```javascript
ANALYSIS_CONFIG.messageLimit = 50; // Messages to analyze per contact
ANALYSIS_CONFIG.aiMessageLimit = 10; // Messages to send to AI
ANALYSIS_CONFIG.batchSize = 50; // Contacts per batch
```

### Cost Optimization

```javascript
// Disable AI to save costs (use rules only)
ANALYSIS_CONFIG.enableAI = false;

// Or disable specific AI analyses
ANALYSIS_CONFIG.enableSummary = false; // Most expensive
```

---

## API Reference

### Tag a Contact

```http
POST /api/tags/contact/:contactId
Content-Type: application/json

{
  "companyId": "uuid",
  "dryRun": false,
  "verbose": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "contactId": "+60123456789",
    "currentTags": ["active", "hot-lead"],
    "recommendedTags": ["active", "hot-lead", "quick-responder"],
    "tagsAdded": ["quick-responder"],
    "tagsRemoved": [],
    "metrics": { ... }
  }
}
```

### Batch Tag Contacts

```http
POST /api/tags/batch
Content-Type: application/json

{
  "companyId": "uuid",
  "limit": 100,
  "dryRun": false
}
```

### Get Contact Tags

```http
GET /api/tags/contact/:contactId?companyId=uuid
```

### Update Tags Manually

```http
PUT /api/tags/contact/:contactId
Content-Type: application/json

{
  "companyId": "uuid",
  "tags": ["vip", "hot-lead"],
  "action": "add" // "set", "add", or "remove"
}
```

### Get Analytics

```http
GET /api/tags/analytics?companyId=uuid&days=7
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalContacts": 1500,
    "taggedContacts": 1350,
    "taggedPercentage": "90.0",
    "topTags": [
      { "tag": "active", "count": 450, "percentage": "30.0" },
      { "tag": "warm-lead", "count": 300, "percentage": "20.0" }
    ],
    "distributionByCategory": [ ... ]
  }
}
```

### Search by Tags

```http
GET /api/tags/search?companyId=uuid&tags=hot-lead,query&matchAll=false&limit=100
```

### Get Tag History

```http
GET /api/tags/history/:contactId?companyId=uuid&limit=50
```

### Get Tag Definitions

```http
GET /api/tags/definitions
```

---

## Automation

### Auto-tag on New Messages

Add this to your message handling code:

```javascript
const { ContactTagger } = require('./contactTagger');

// When a new message arrives
async function onNewMessage(message, contactId, companyId) {
  // ... existing message handling code ...

  // Trigger auto-tagging (async, don't wait)
  const tagger = new ContactTagger(companyId, { verbose: false });
  tagger.tagContact(contactId).catch(err => {
    console.error('Auto-tagging failed:', err);
  });
}
```

### Scheduled Re-tagging

Add to your cron jobs:

```javascript
const cron = require('node-cron');
const { ContactTagger } = require('./contactTagger');

// Re-tag all contacts daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('Running scheduled contact tagging...');

  const companies = await getActiveCompanies(); // Your function

  for (const company of companies) {
    const tagger = new ContactTagger(company.id, { verbose: false });
    await tagger.tagAllContacts();
  }

  console.log('Scheduled tagging complete!');
});
```

### Queue-based Processing

Use BullMQ for async processing:

```javascript
const { Queue, Worker } = require('bullmq');
const { ContactTagger } = require('./contactTagger');

const taggingQueue = new Queue('contact-tagging', {
  connection: { /* Redis config */ }
});

// Add to queue
await taggingQueue.add('tag-contact', {
  companyId: 'uuid',
  contactId: '+60123456789'
});

// Worker
const worker = new Worker('contact-tagging', async (job) => {
  const { companyId, contactId } = job.data;
  const tagger = new ContactTagger(companyId);
  return await tagger.tagContact(contactId);
}, {
  connection: { /* Redis config */ }
});
```

---

## Cost Estimates

### AI Costs (GPT-4o-mini)

**Per Contact Analysis:**
- Input: ~300 tokens (10 messages × 30 tokens avg)
- Output: ~20 tokens
- Cost: ~$0.00006 per contact

**1,000 Contacts:**
- Total cost: ~$0.06

**10,000 Contacts:**
- Total cost: ~$0.60

**Monthly (30k contacts, daily updates):**
- Total cost: ~$54/month

### Cost Optimization Tips

1. **Disable AI for some contacts**: Only use AI for active contacts
2. **Reduce AI message limit**: Analyze fewer messages
3. **Disable summary generation**: Most expensive feature
4. **Cache results**: Don't re-analyze unchanged conversations
5. **Use rules-only mode**: Set `enableAI: false`

---

## Monitoring

### Check Tag Distribution

```bash
node tagCLI.js stats <companyId>
```

### Query Database Directly

```sql
-- Top 10 most used tags
SELECT
  unnest(string_to_array(tags, ',')) as tag,
  COUNT(*) as count
FROM contacts
WHERE company_id = 'your-company-id'
GROUP BY tag
ORDER BY count DESC
LIMIT 10;

-- Recent tagging activity
SELECT tag, action, COUNT(*)
FROM contact_tag_history
WHERE company_id = 'your-company-id'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY tag, action;

-- Contacts needing attention
SELECT contact_id, phone, name, tags
FROM contacts
WHERE company_id = 'your-company-id'
  AND tags LIKE '%needs-attention%';
```

---

## Troubleshooting

### No tags being applied

1. Check if messages exist for the contact
2. Verify tag rules in `tagConfig.js`
3. Run with `--verbose` flag to see metrics
4. Check if contact has minimum messages for behavioral analysis (5+)

### AI analysis failing

1. Verify `OPENAI_API_KEY` is set in `.env`
2. Check OpenAI API quota/billing
3. Try with `--no-ai` flag to test rule-based only
4. Check logs for API errors

### Slow performance

1. Reduce `ANALYSIS_CONFIG.messageLimit`
2. Disable AI: `ANALYSIS_CONFIG.enableAI = false`
3. Process in smaller batches
4. Add database indexes on `contact_id` and `tags` columns

### Tags not updating

1. Check if `dryRun: false`
2. Verify database permissions
3. Check `contact_tag_history` for errors
4. Review tag rules - may no longer match criteria

---

## Examples

### Example 1: Tag a Single Contact

```bash
$ node tagCLI.js tag-one abc-123 +60123456789 --verbose

============================================================
Tagging contact: +60123456789
============================================================
Found 25 messages for contact +60123456789

Metrics: {
  "totalMessages": 25,
  "daysSinceLastMessage": 1,
  "averageResponseTime": 1800,
  "aiSentiment": "positive",
  "aiIntent": "inquiry"
}

Tag Classification:
  Current: active,warm-lead
  Recommended: active,hot-lead,quick-responder,query
  To Add: hot-lead,quick-responder,query
  To Remove: warm-lead

✓ Tags updated for +60123456789
```

### Example 2: Batch Process

```bash
$ node tagCLI.js tag-all abc-123 50

Fetching contacts for company abc-123...
Found 50 contacts to process

Processing batch 1/1
[Progress indicators...]

============================================================
Batch Processing Complete
============================================================
Total: 50
Success: 48
Failed: 2

Tags Applied:
  active: 25 contacts
  warm-lead: 15 contacts
  dormant: 8 contacts
```

### Example 3: API Usage

```javascript
// Tag a contact after receiving a message
app.post('/webhook/message', async (req, res) => {
  const { contactId, companyId, message } = req.body;

  // Save message to database...

  // Auto-tag the contact
  const response = await fetch('http://localhost:3000/api/tags/contact/' + contactId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId })
  });

  const result = await response.json();
  console.log('Tags updated:', result.data.tagsAdded);

  res.json({ success: true });
});
```

---

## Files Structure

```
bisnesgpt-server/
├── contactTagger.js              # Main tagging engine
├── tagConfig.js                  # Tag definitions and rules
├── tagCLI.js                     # Command-line tool
├── routes/
│   └── contactTagging.js         # API routes
├── migrations/
│   └── 001_contact_tagging_tables.sql
└── CONTACT_TAGGING_README.md     # This file
```

---

## Next Steps

1. **Run the migration**: Set up database tables
2. **Test with CLI**: Tag a few contacts to verify
3. **Review tags**: Check if they make sense for your business
4. **Customize rules**: Adjust thresholds in `tagConfig.js`
5. **Integrate API**: Add routes to `server.js`
6. **Set up automation**: Add cron jobs or queue workers
7. **Monitor costs**: Track OpenAI usage

---

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the code comments in `contactTagger.js`
3. Test with `--verbose` and `--dry-run` flags
4. Check database logs and `contact_tag_history` table

---

**Built with:**
- PostgreSQL (Neon)
- OpenAI GPT-4o-mini
- Node.js
- Express.js

**License:** MIT
