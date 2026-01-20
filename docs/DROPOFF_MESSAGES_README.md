# Drop-Off Message Tracking

## Overview
The contact tagging system now tracks **the actual messages that contacts didn't respond to**, helping you understand what messaging patterns lead to drop-offs.

## Key Features

### 1. **Unanswered Message Capture**
- Captures the last 3 unanswered messages (configurable)
- Only includes messages from the last 4 months (120 days)
- Stores message content, timestamp, and days since sent

### 2. **Data Structure**
Each contact's drop-off data is stored in `custom_fields.analytics.response_drop_point`:

```json
{
  "stage": "awaiting_reply",
  "unanswered_count": 2,
  "last_message_days_ago": 5,
  "unanswered_messages": [
    {
      "content": "Hi, just following up on our previous conversation...",
      "timestamp": "2025-10-11T10:30:00.000Z",
      "message_id": "true_60124866646@c.us_...",
      "days_ago": 5
    },
    {
      "content": "Are you still interested in our services?",
      "timestamp": "2025-10-08T14:20:00.000Z",
      "message_id": "true_60124866646@c.us_...",
      "days_ago": 8
    }
  ]
}
```

### 3. **Configuration**

#### Time Filters
- **Contact Activity Window**: 120 days (4 months)
  - Location: `quick-populate.js` line 31
  - Only analyzes contacts with messages in last 4 months

- **Message Age Filter**: 120 days (4 months)
  - Location: `contactTagger.js` line 208
  - Only captures unanswered messages from last 4 months

#### Message Limit
- **Sample Size**: 3 messages per contact
  - Location: `tagConfig.js` line 439
  - Setting: `unansweredMessageSampleLimit: 3`

## Usage

### Running Analysis
```bash
# Analyze contacts from last 4 months
node quick-populate.js 0210
```

### Viewing in Dashboard
1. Start analytics server: `node analytics-server.js`
2. Open: http://localhost:3005
3. Select company "0210"
4. Go to "Bottlenecks" tab
5. Click on any drop-off point to see unanswered messages

### API Access
```bash
# Get bottleneck data with unanswered messages
GET /api/lead-analytics/0210/bottlenecks?timeRange=120

# Response includes:
{
  "drop_points": [
    {
      "stage": "awaiting_reply",
      "unanswered_count": 2,
      "contact_count": 15,
      "sample_contacts": [
        {
          "contact_id": "0210-60124866646",
          "name": "Chris",
          "unanswered_messages": [...]
        }
      ]
    }
  ]
}
```

### Database Query
```sql
-- Get contacts with unanswered messages
SELECT
  contact_id,
  name,
  custom_fields->'analytics'->'response_drop_point'->'unanswered_messages' as unanswered
FROM contacts
WHERE company_id = '0210'
  AND custom_fields->'analytics'->'response_drop_point'->'unanswered_messages' IS NOT NULL
  AND jsonb_array_length(
    custom_fields->'analytics'->'response_drop_point'->'unanswered_messages'
  ) > 0;
```

## Use Cases

### 1. **Message Pattern Analysis**
Identify which messages or message types lead to drop-offs:
- Generic follow-ups vs. personalized
- Questions vs. statements
- Timing of messages

### 2. **Reactivation Strategy**
Know exactly what was last said before re-engaging:
- Avoid repeating the same unanswered message
- Reference previous conversation context
- Adjust approach based on what didn't work

### 3. **Template Optimization**
Improve message templates by analyzing what gets ignored:
- A/B test different message styles
- Identify ineffective phrases
- Optimize message length and tone

### 4. **Sales Training**
Train sales team on:
- What messages prospects ignore
- When to stop following up
- How to re-engage dormant leads

## Analytics Dashboard Features

### Drop-Off Points Card
- Shows top 5 drop-off stages
- Displays sample unanswered messages (preview)
- Click to see full details in modal

### Modal View
- Shows all sample contacts for that drop-off stage
- Full message content (not truncated)
- Days since each message was sent
- Contact name/ID for reference

## Technical Details

### Files Modified
1. **contactTagger.js**
   - Added `extractUnansweredMessages()` method (line 200-236)
   - Enhanced `detectDropPoint()` to include messages (line 942-1010)
   - Updated `calculateEngagementMetrics()` (line 175-198)

2. **quick-populate.js**
   - Changed `daysFilter` from 30 to 120 days (line 31)

3. **routes/leadAnalytics.js**
   - Updated bottleneck query to include unanswered messages (line 52-78)
   - Modified response format (line 125-130)

4. **analytics-dashboard/app.js**
   - Enhanced `renderDropPointsList()` to show messages (line 161-217)
   - Added `showDropPointDetails()` modal (line 219-273)

## Configuration Options

### Change Message Sample Size
Edit `tagConfig.js`:
```javascript
unansweredMessageSampleLimit: 5  // Capture last 5 messages instead of 3
```

### Change Time Window
Edit `contactTagger.js` line 208:
```javascript
const fourMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000); // 6 months
```

### Change Contact Filter
Edit `quick-populate.js` line 31:
```javascript
daysFilter: 180  // Analyze 6 months of contacts
```

## Best Practices

1. **Regular Analysis**: Run `quick-populate.js` weekly to keep data fresh
2. **Review Patterns**: Check dashboard monthly for drop-off trends
3. **Test Messaging**: Use insights to A/B test different approaches
4. **Clean Data**: Messages older than 4 months are automatically excluded

## Troubleshooting

### No Unanswered Messages Showing
- Check if contacts have outbound messages in last 4 months
- Verify `unansweredMessages` array is not empty in database
- Ensure analytics server is running latest code

### Missing Contact Data
- Run `node quick-populate.js 0210` to regenerate analytics
- Check `daysFilter` setting in quick-populate.js
- Verify contacts have recent message activity

## Future Enhancements
- [ ] AI analysis of unanswered message patterns
- [ ] Automatic message effectiveness scoring
- [ ] Suggested alternative messages based on drop-offs
- [ ] Integration with message template system
