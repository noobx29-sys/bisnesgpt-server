# ✅ Updated: Fast Analytics Population (Last 30 Days Only)

## 🚀 Quick Run

```bash
node quick-populate.js 0210
```

## What Changed?

**Before:** Analyzed ALL contacts (could take hours for large databases)

**Now:** Only analyzes contacts with message activity in the **last 30 days**

This makes the analysis:
- ⚡ **Much faster** (only active contacts)
- 💰 **Cheaper** (fewer AI API calls)
- 🎯 **More relevant** (focuses on recent leads)

## Example Output

```bash
============================================================
📊 Analyzing Company: 0210
📅 Filtering: Contacts with activity in last 30 days
============================================================

📊 Total contacts to analyze: 45  # Instead of 145!
⏳ Starting analysis...

Processing batch 1/1
✓ Tags updated for 0210-60123456789
✓ Tags updated for 0210-60987654321
...

✅ Analysis Complete!
   Total: 45
   Success: 45
   Failed: 0
   Duration: 23.5s  # Much faster!
```

## How It Works

The script now filters contacts using this SQL:
```sql
SELECT DISTINCT c.contact_id, c.phone, c.name, c.tags
FROM contacts c
WHERE c.company_id = $1
  AND c.is_group = false
  AND EXISTS (
    SELECT 1 FROM messages m
    WHERE m.contact_id = c.contact_id
      AND m.company_id = c.company_id
      AND m.timestamp >= NOW() - INTERVAL '30 days'
  )
```

## Customizing the Time Range

If you want a different time range, edit `quick-populate.js`:

```javascript
const tagger = new ContactTagger(companyId, {
  verbose: true,
  aiEnabled: true,
  dryRun: false,
  daysFilter: 7   // Change to 7, 14, 60, 90, etc.
});
```

Or remove the filter entirely:
```javascript
const tagger = new ContactTagger(companyId, {
  verbose: true,
  aiEnabled: true,
  dryRun: false
  // No daysFilter = analyze ALL contacts
});
```

## Run It Now!

```bash
# 1. Populate analytics (last 30 days only)
node quick-populate.js 0210

# 2. Start analytics server
node analytics-server.js

# 3. Open dashboard
# http://localhost:3005
```

This should complete in a few minutes instead of hours! 🎉
