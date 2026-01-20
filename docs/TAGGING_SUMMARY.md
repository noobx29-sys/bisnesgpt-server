# Contact Tagging System - Final Configuration

## ✅ Complete Setup

### 1. Database Setup
Run this SQL in your database editor:
```bash
# Copy and paste content from create_tag_tables.sql
```

This creates:
- `contact_tag_history` - Audit trail of all tag changes
- `contact_tag_analytics` - Pre-computed statistics
- `tag_definitions` - 23 default tags with rules

### 2. Key Features Configured

#### ✅ Groups vs Leads
- **Groups are EXCLUDED** from tagging (phone contains `@g.us`)
- **Only individual leads** are tagged (phone with `@c.us` or regular numbers)
- Groups are automatically skipped during batch processing

#### ✅ Additive Tagging (Never Remove)
- Tags are **ONLY ADDED**, never removed
- Existing tags are **ALWAYS PRESERVED**
- New tags are merged with existing ones

#### ✅ JSONB Array Support
- Tags stored as JSONB arrays: `["active", "hot-lead"]`
- Automatically converts between JavaScript arrays and PostgreSQL JSONB
- Supports rich querying with `@>` operator

#### ✅ Follow-up Detection
- Automatically detects active follow-up sequences
- Tags contacts based on `scheduled_messages` table
- Tracks: `followup-active`, `followup-completed`, `followup-responded`

---

## 📋 Available Tags (23 Total)

### Status Tags (6)
- `new` - No messages yet, first day only
- `active` - Recent back-and-forth (<3 days)
- `query` - Last message contains questions
- `closed` - Closing phrases detected
- `dormant` - No activity in 30+ days
- `cold` - 3+ unanswered outbound messages

### Engagement Tags (5)
- `hot-lead` - Fast responses (<1hr), positive signals
- `warm-lead` - Moderate engagement (responses within 24hrs)
- `cold-lead` - Low engagement (slow responses >48hrs)
- `interested` - Keywords: price, cost, buy, etc.
- `not-interested` - Keywords: no thanks, not now, etc.

### Behavioral Tags (5)
- `quick-responder` - Avg response time <1hr
- `slow-responder` - Avg response time >24hrs
- `night-owl` - 50%+ messages 10PM-6AM
- `business-hours` - 70%+ messages 9AM-5PM
- `weekend-active` - 40%+ messages on weekends

### Action Tags (4)
- `follow-up-needed` - Unanswered question, 2-7 days old
- `awaiting-response` - We sent last message <7 days ago
- `needs-attention` - Urgent keywords, complaints
- `vip` - Manually assigned

### Follow-up Tags (3)
- `followup-active` - Has scheduled template messages
- `followup-completed` - All template messages sent
- `followup-responded` - Replied during sequence

---

## 🚀 Usage

### Tag All Contacts (Excluding Groups)
```bash
node tagCLI.js tag-all 0210 50
```

### Tag Single Contact
```bash
node tagCLI.js tag-one 0210 0210-60123456789 --verbose
```

### View Statistics
```bash
node tagCLI.js stats 0210
```

### Test Without Saving
```bash
node tagCLI.js test 0210 0210-60123456789
```

---

## 🔍 How Groups Are Filtered

### Database Query Filter
```sql
-- getAllContacts excludes groups
WHERE company_id = '0210'
  AND (phone NOT LIKE '%@g.us' OR phone IS NULL)
```

### Runtime Check
```javascript
// tagContact skips groups
if (contact.phone && contact.phone.includes('@g.us')) {
  return { skipped: true, reason: 'Group chat' };
}
```

---

## 📊 Tag Logic Examples

### "active" Tag
```javascript
// Applied when:
- daysSinceLastMessage <= 3 days
- hasRecentExchange (both parties messaged)
- messageCount >= 1
```

### "hot-lead" Tag
```javascript
// Applied when:
- averageResponseTime <= 1 hour
- messageExchangeRate >= 0.8 (balanced conversation)
- Has positive keywords: interested, yes, etc.
```

### "dormant" Tag
```javascript
// Applied when:
- daysSinceLastMessage >= 30 days
```

### "followup-active" Tag
```javascript
// Applied when:
- Has records in scheduled_messages with template_id
- status = 'scheduled' (not yet sent)
```

---

## 🎯 AI Analysis (GPT-4o-mini)

Uses cheap AI model for:
- **Sentiment**: positive/negative/neutral
- **Intent**: inquiry/purchase/support/complaint/feedback/general/spam
- **Stage**: initial/ongoing/closing/closed/stalled

**Cost**: ~$0.06 per 1000 contacts

Disable AI to save costs:
```javascript
// In tagConfig.js
ANALYSIS_CONFIG.enableAI = false;
```

---

## 🔧 Customization

### Add Custom Keywords
Edit [tagConfig.js](tagConfig.js):
```javascript
KEYWORDS.interest.push('demo', 'trial', 'sample');
```

### Change Tag Rules
```javascript
// Make dormant = 60 days instead of 30
DEFAULT_TAGS.dormant.rules.daysSinceLastMessage = { min: 60 };
```

### Adjust Processing Limits
```javascript
ANALYSIS_CONFIG.messageLimit = 100; // Analyze more messages
ANALYSIS_CONFIG.batchSize = 100;    // Process more at once
```

---

## ✨ Key Differences from Original Plan

| Feature | Original | Final Implementation |
|---------|----------|---------------------|
| Tag Storage | TEXT[] array | **JSONB array** |
| Company ID | UUID | **VARCHAR** |
| Tag Removal | Yes | **No - additive only** |
| Groups | Not filtered | **Excluded completely** |
| "new" Tag | Everyone | **Only 0 messages + first day** |

---

## 🐛 Troubleshooting

### Groups Still Being Tagged?
Check the phone column format:
```sql
SELECT contact_id, phone,
  CASE WHEN phone LIKE '%@g.us' THEN 'GROUP' ELSE 'LEAD' END as type
FROM contacts WHERE company_id = '0210' LIMIT 10;
```

### Everyone Tagged as "new"?
The rule requires:
- `totalMessages = 0` (no messages at all)
- `daysSinceFirstContact <= 1` (added within last day)

Check:
```bash
node tagCLI.js tag-one 0210 CONTACT_ID --verbose
# Look at metrics.totalMessages
```

### Tags Not Persisting?
Check JSONB format:
```sql
SELECT contact_id, tags, pg_typeof(tags) as type
FROM contacts WHERE company_id = '0210' LIMIT 5;
```
Should show `type = jsonb`

---

## 📁 Files Created

- [create_tag_tables.sql](create_tag_tables.sql) - Database migration
- [contactTagger.js](contactTagger.js) - Main tagging engine
- [tagConfig.js](tagConfig.js) - Tag rules and configuration
- [tagCLI.js](tagCLI.js) - Command-line tool
- [routes/contactTagging.js](routes/contactTagging.js) - API endpoints
- [CONTACT_TAGGING_README.md](CONTACT_TAGGING_README.md) - Full documentation
- [FOLLOWUP_TAGGING.md](FOLLOWUP_TAGGING.md) - Follow-up feature docs
- [TAGGING_QUICK_START.md](TAGGING_QUICK_START.md) - Quick reference

---

**System is ready! Run `node tagCLI.js tag-all 0210 15` to test with 15 contacts.**
