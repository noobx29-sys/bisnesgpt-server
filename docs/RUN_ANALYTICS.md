# 🚀 How to Run Lead Analytics

## Step 1: Populate Analytics Data

Before viewing the dashboard, you need to analyze your contacts and populate the analytics data.

### Option A: Interactive Script (Recommended)
```bash
node populate-analytics.js
```
This will:
- Show you all companies in your database
- Let you select which company to analyze
- Run the contact tagger
- Populate all analytics fields

### Option B: Quick Run (Single Company)
```bash
node quick-populate.js YOUR_COMPANY_ID
```

Example:
```bash
node quick-populate.js 0210
```

### What This Does:
1. Analyzes all messages for each contact
2. Calculates metrics (response time, engagement rate, etc.)
3. Detects bottlenecks (where leads stop responding)
4. Identifies reactivation candidates
5. Stores everything in `contacts.custom_fields.analytics`

**⏱️ Time:** ~1-5 seconds per contact (depending on AI analysis)

---

## Step 2: Start Analytics Server

```bash
# Default port (3005)
node analytics-server.js

# Or custom port
ANALYTICS_PORT=3006 node analytics-server.js
```

You should see:
```
============================================================
🚀 Lead Analytics Server Started
============================================================
📊 Dashboard: http://localhost:3005
🔌 API Info: http://localhost:3005/api/lead-analytics
💚 Health: http://localhost:3005/api/health
🏢 Companies: http://localhost:3005/api/companies
============================================================
```

---

## Step 3: Open Dashboard

Open your browser and go to:
```
http://localhost:3005
```

1. **Select your company** from the dropdown
2. **View analytics** across 4 tabs:
   - Bottlenecks
   - Follow-up Performance
   - Pipeline
   - Reactivation

---

## Troubleshooting

### "No data showing" or "0.00%"
**Problem:** Analytics data hasn't been populated yet

**Solution:** Run Step 1 first
```bash
node quick-populate.js YOUR_COMPANY_ID
```

### "Pipeline visualization error"
**Problem:** Old server code is cached

**Solution:** 
1. Stop the server (Ctrl+C)
2. Restart it: `node analytics-server.js`
3. Hard refresh browser (Ctrl+Shift+R)

### "Port already in use"
**Problem:** Port 3005 is taken

**Solution:** Use a different port
```bash
ANALYTICS_PORT=3006 node analytics-server.js
```

### "No companies found"
**Problem:** No contacts in database

**Solution:** Make sure you have contacts in your `contacts` table

---

## Full Example Workflow

```bash
# 1. Populate analytics for company 0210
node quick-populate.js 0210

# Output:
# ============================================================
# 📊 Analyzing Company: 0210
# ============================================================
# 
# Found 145 contacts to analyze
# ⏳ Starting analysis...
# 
# ✅ Analysis Complete!
#    Total: 145
#    Success: 145
#    Failed: 0
#    Duration: 87.3s

# 2. Start the analytics server
node analytics-server.js

# 3. Open browser
# http://localhost:3005

# 4. Select "0210" from dropdown

# 5. View your analytics! 📊
```

---

## Re-running Analysis

If you want to update the analytics (e.g., after new messages):

```bash
# Stop the analytics server (Ctrl+C)

# Re-run the population script
node quick-populate.js 0210

# Restart the analytics server
node analytics-server.js

# Refresh the dashboard in your browser
```

---

## What Gets Populated

After running the populate script, each contact will have:

```json
{
  "custom_fields": {
    "analytics": {
      "last_response_stage": "stopped_replying",
      "response_drop_point": {
        "stage": "mid_conversation",
        "unanswered_messages": 3
      },
      "consecutive_no_reply": 3,
      "avg_response_time_seconds": 7200,
      "message_exchange_rate": 0.35,
      "days_since_last_message": 12,
      "followup_template_id": null,
      "followup_progress": null,
      "followup_responded": false,
      "reactivation_eligible": true,
      "reactivation_priority": 8,
      "last_analyzed_at": "2025-10-16T10:00:00Z"
    }
  }
}
```

---

## Automation (Optional)

To automatically update analytics daily:

### Using Cron
```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * cd /home/firaz/backend/bisnesgpt-server && node quick-populate.js 0210
```

### Using PM2
```bash
# Install PM2
npm install -g pm2

# Start analytics server with PM2
pm2 start analytics-server.js --name "analytics"

# Save PM2 config
pm2 save
pm2 startup
```

---

## Performance Tips

1. **Disable AI analysis** for faster processing (less accurate):
   ```javascript
   // In contactTagger.js, set:
   enableAI: false
   ```

2. **Limit contacts** during testing:
   ```javascript
   // In quick-populate.js, modify tagAllContacts call:
   await tagger.tagAllContacts(10); // Only analyze 10 contacts
   ```

3. **Batch processing**: The tagger already processes in batches of 50

---

## Next Steps

Once analytics are populated and dashboard is running:

1. **Identify bottlenecks** - See where most leads drop off
2. **Optimize follow-ups** - Use best-performing templates
3. **Reactivate leads** - Trigger campaigns for dormant contacts
4. **Monitor pipeline** - Track lead distribution across stages

Happy analyzing! 📊
