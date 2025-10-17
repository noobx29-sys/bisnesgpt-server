# 🚀 Quick Start - Lead Analytics Server

## Start the Server

```bash
# Option 1: Using custom port
ANALYTICS_PORT=3005 node analytics-server.js

# Option 2: Using default port (3001)
node analytics-server.js

# Option 3: Using the startup script
chmod +x start-analytics.sh
./start-analytics.sh
```

## Access the Dashboard

Once the server is running, open your browser:

```
http://localhost:3005
```

## Test the API

### 1. Check Server Health
```bash
curl http://localhost:3005/api/health
```

### 2. Get API Info
```bash
curl http://localhost:3005/api/lead-analytics
```

### 3. List Companies
```bash
curl http://localhost:3005/api/companies
```

### 4. Get Bottlenecks (replace 0210 with your company ID)
```bash
curl http://localhost:3005/api/lead-analytics/0210/bottlenecks
```

### 5. Get Follow-up Performance
```bash
curl http://localhost:3005/api/lead-analytics/0210/followup-performance
```

### 6. Get Pipeline
```bash
curl http://localhost:3005/api/lead-analytics/0210/pipeline
```

### 7. Get Reactivation Candidates
```bash
curl http://localhost:3005/api/lead-analytics/0210/reactivation?minPriority=7
```

## Dashboard Features

### 1. **Bottlenecks Tab**
- Shows where leads stop responding
- Visual funnel chart
- Drop-off point analysis
- Reply rate metrics

### 2. **Follow-up Performance Tab**
- Template performance rankings
- Best/worst templates
- Response rates
- Average response times

### 3. **Pipeline Tab**
- Lead distribution across stages
- Conversion rates
- Stage-specific metrics
- Sample contacts per stage

### 4. **Reactivation Tab**
- List of eligible contacts
- Priority scoring (1-10)
- Filter by priority
- Bulk campaign trigger

## How to Use

1. **Select a Company**: Use the dropdown in the top-right
2. **View Analytics**: Click through the tabs
3. **Refresh Data**: Click the "Refresh" button
4. **Trigger Campaigns**: Select contacts and click "Trigger Campaign"

## Troubleshooting

### Port Already in Use
```bash
# Use a different port
ANALYTICS_PORT=3006 node analytics-server.js
```

### No Data Showing
```bash
# Run the contact tagger first to populate analytics
node -e "
const { ContactTagger } = require('./contactTagger');
const tagger = new ContactTagger('YOUR_COMPANY_ID');
tagger.tagAllContacts().then(() => console.log('Done!'));
"
```

### Database Connection Error
- Check your `.env` file has `DATABASE_URL`
- Verify database credentials
- Ensure database is accessible

## API Response Examples

### Bottlenecks Response
```json
{
  "success": true,
  "summary": {
    "total_contacts": 1000,
    "replied_count": 450,
    "reply_rate": "45.00%",
    "active_rate": "12.00%"
  },
  "bottlenecks": [
    {
      "stage": "never_replied",
      "count": 350,
      "percentage": "35.00%",
      "avg_days_dormant": 15.5
    }
  ]
}
```

### Pipeline Response
```json
{
  "success": true,
  "total_leads": 1000,
  "stages": [
    {
      "stage": "new_lead",
      "stage_label": "New Lead",
      "count": 250,
      "percentage": "25.00%"
    }
  ],
  "conversion_rates": {
    "new_to_contacted": "72.00%",
    "contacted_to_engaged": "66.67%"
  }
}
```

## Next Steps

1. ✅ Server is running on port 3005
2. ✅ Dashboard is accessible at http://localhost:3005
3. ✅ API endpoints are working
4. 📊 Select a company and explore the analytics
5. 🎯 Identify bottlenecks and optimize your follow-ups
6. 🔄 Trigger reactivation campaigns for dormant leads

## Support

- API Documentation: See `LEAD_ANALYTICS_README.md`
- Server Setup: See `ANALYTICS_SERVER_README.md`
- Contact Tagger: See `contactTagger.js` comments
