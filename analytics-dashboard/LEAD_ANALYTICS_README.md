# Lead Analytics System

Complete analytics system for tracking lead behavior, identifying bottlenecks, analyzing follow-up performance, and detecting reactivation opportunities.

## Features

### 1. **Bottleneck Detection**
Identifies where leads stop responding in the conversation funnel.

**Endpoint:** `GET /api/lead-analytics/:companyId/bottlenecks`

**Query Parameters:**
- `timeRange` (optional): Number of days to analyze (default: 30)

**Response:**
```json
{
  "success": true,
  "timeRange": "30 days",
  "summary": {
    "total_contacts": 1000,
    "replied_count": 450,
    "active_count": 120,
    "reply_rate": "45.00%",
    "active_rate": "12.00%"
  },
  "bottlenecks": [
    {
      "stage": "never_replied",
      "count": 350,
      "percentage": "35.00%",
      "avg_days_dormant": 15.5,
      "avg_unanswered_messages": 2.3
    },
    {
      "stage": "stopped_replying",
      "count": 200,
      "percentage": "20.00%",
      "avg_days_dormant": 8.2,
      "avg_unanswered_messages": 3.1
    }
  ],
  "drop_points": [
    {
      "stage": "initial_outreach",
      "messages_sent": 2,
      "unanswered_messages": 0,
      "count": 180
    }
  ]
}
```

**Stages:**
- `never_contacted`: Lead was never contacted
- `never_replied`: Lead never responded to initial outreach
- `stopped_replying`: Lead stopped responding mid-conversation
- `went_dormant`: Lead went inactive after engagement
- `awaiting_reply`: Waiting for lead's response
- `active`: Currently engaged

---

### 2. **Follow-up Performance Tracking**
Analyzes which follow-up sequences perform best/worst.

**Endpoint:** `GET /api/lead-analytics/:companyId/followup-performance`

**Query Parameters:**
- `templateId` (optional): Filter by specific template

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_templates": 5,
    "best_performing": {
      "template_id": "abc123",
      "template_name": "Re-engagement Sequence",
      "response_rate": 35.5,
      "total_sent": 200
    },
    "worst_performing": {
      "template_id": "xyz789",
      "template_name": "Cold Outreach",
      "response_rate": 8.2,
      "total_sent": 150
    },
    "avg_response_rate": "18.5%"
  },
  "templates": [
    {
      "template_id": "abc123",
      "template_name": "Re-engagement Sequence",
      "total_sent": 200,
      "responded": 71,
      "completed": 180,
      "response_rate": 35.5,
      "avg_response_hours": 4.2,
      "rank": 1,
      "performance_tier": "excellent"
    }
  ]
}
```

**Performance Tiers:**
- `excellent`: ≥30% response rate
- `good`: 15-29% response rate
- `average`: 5-14% response rate
- `poor`: <5% response rate

---

### 3. **Pipeline Stage Visualization**
Shows distribution of leads across pipeline stages.

**Endpoint:** `GET /api/lead-analytics/:companyId/pipeline`

**Response:**
```json
{
  "success": true,
  "total_leads": 1000,
  "stages": [
    {
      "stage": "new_lead",
      "stage_label": "New Lead",
      "count": 250,
      "percentage": "25.00%",
      "avg_days_dormant": 2.1,
      "avg_engagement": 0.0,
      "sample_contacts": [...]
    },
    {
      "stage": "contacted",
      "stage_label": "Initial Contact",
      "count": 180,
      "percentage": "18.00%",
      "avg_days_dormant": 1.5,
      "avg_engagement": 0.15
    },
    {
      "stage": "engaged",
      "stage_label": "Engaged",
      "count": 120,
      "percentage": "12.00%",
      "avg_days_dormant": 0.8,
      "avg_engagement": 0.45
    },
    {
      "stage": "stalled",
      "stage_label": "Stalled",
      "count": 200,
      "percentage": "20.00%",
      "avg_days_dormant": 12.3,
      "avg_engagement": 0.25
    },
    {
      "stage": "dormant",
      "stage_label": "Dormant",
      "count": 250,
      "percentage": "25.00%",
      "avg_days_dormant": 45.2,
      "avg_engagement": 0.18
    }
  ],
  "conversion_rates": {
    "new_to_contacted": "72.00%",
    "contacted_to_engaged": "66.67%",
    "overall_engagement": "12.00%"
  }
}
```

**Pipeline Stages:**
1. **New Lead**: Never contacted or never replied
2. **Initial Contact**: Contacted within last 3 days, awaiting reply
3. **Engaged**: Active back-and-forth conversation
4. **Stalled**: Stopped replying but within 30 days
5. **Dormant**: No activity for 30+ days

---

### 4. **Reactivation Candidates**
Identifies contacts that should be reactivated.

**Endpoint:** `GET /api/lead-analytics/:companyId/reactivation`

**Query Parameters:**
- `minPriority` (optional): Minimum priority score (1-10, default: 5)
- `limit` (optional): Max number of results (default: 100)

**Response:**
```json
{
  "success": true,
  "total_candidates": 85,
  "priority_distribution": {
    "high": 25,
    "medium": 40,
    "low": 20
  },
  "candidates": [
    {
      "contact_id": "0210-60123456789",
      "name": "John Doe",
      "phone": "+60123456789",
      "tags": ["warm-lead", "dormant"],
      "priority": 8,
      "priority_tier": "high",
      "days_dormant": 15,
      "engagement_rate": 0.35,
      "avg_response_hours": "2.50",
      "last_stage": "stopped_replying",
      "last_updated": "2025-10-01T10:00:00Z",
      "created_at": "2025-09-15T08:30:00Z"
    }
  ]
}
```

**Reactivation Criteria:**
- Had previous engagement (replied at least once)
- Not currently active
- Between 7-90 days since last message
- No active follow-up running
- Not marked as not-interested or spam

**Priority Scoring (1-10):**
- Base: 5
- +2 for high engagement rate (>30%)
- +1 for moderate engagement (>20%)
- +2 for recent dormancy (7-30 days)
- -1 for very old leads (>60 days)
- +1 for showed interest keywords
- +1 for quick responders (<1 hour avg)

---

### 5. **Trigger Reactivation Campaign**
Starts a reactivation campaign for selected contacts.

**Endpoint:** `POST /api/lead-analytics/:companyId/reactivation/trigger`

**Request Body:**
```json
{
  "contactIds": ["0210-60123456789", "0210-60987654321"],
  "templateId": "reactivation_template_1",
  "minPriority": 5,
  "autoSelect": false
}
```

**Parameters:**
- `contactIds` (optional): Array of specific contact IDs to reactivate
- `templateId` (required): Follow-up template to use
- `minPriority` (optional): Minimum priority for auto-selection (default: 5)
- `autoSelect` (optional): Auto-select top 100 contacts by priority (default: false)

**Response:**
```json
{
  "success": true,
  "message": "Reactivation campaign prepared for 85 contacts",
  "template_id": "reactivation_template_1",
  "contacts": [
    {
      "contact_id": "0210-60123456789",
      "phone": "+60123456789"
    }
  ],
  "next_steps": [
    "Review the contact list",
    "Configure reactivation message template",
    "Schedule the campaign",
    "Monitor response rates"
  ]
}
```

---

## Data Storage

All analytics data is stored in the `contacts` table's `custom_fields` JSONB column under the `analytics` key:

```json
{
  "analytics": {
    // Bottleneck detection
    "last_response_stage": "stopped_replying",
    "response_drop_point": {
      "stage": "mid_conversation",
      "unanswered_messages": 3,
      "last_message_days_ago": 12,
      "had_engagement": true
    },
    "consecutive_no_reply": 3,
    
    // Engagement metrics
    "avg_response_time_seconds": 7200,
    "message_exchange_rate": 0.35,
    "days_since_last_message": 12,
    
    // Follow-up tracking
    "followup_template_id": "template_123",
    "followup_progress": "2/5",
    "followup_responded": false,
    
    // Reactivation eligibility
    "reactivation_eligible": true,
    "reactivation_priority": 8,
    
    // Metadata
    "last_analyzed_at": "2025-10-16T10:00:00Z"
  }
}
```

---

## Usage Examples

### Frontend Integration

```javascript
// 1. Get bottleneck analysis
const bottlenecks = await fetch('/api/lead-analytics/0210/bottlenecks?timeRange=30');
const data = await bottlenecks.json();

// Display funnel chart
displayFunnel(data.bottlenecks);

// 2. Get follow-up performance
const performance = await fetch('/api/lead-analytics/0210/followup-performance');
const perfData = await performance.json();

// Show best/worst templates
showTemplateComparison(perfData.summary);

// 3. Get pipeline visualization
const pipeline = await fetch('/api/lead-analytics/0210/pipeline');
const pipelineData = await pipeline.json();

// Display pipeline stages
displayPipelineChart(pipelineData.stages);

// 4. Get reactivation candidates
const reactivation = await fetch('/api/lead-analytics/0210/reactivation?minPriority=7');
const reactivationData = await reactivation.json();

// Show high-priority contacts
displayReactivationList(reactivationData.candidates);

// 5. Trigger reactivation campaign
const campaign = await fetch('/api/lead-analytics/0210/reactivation/trigger', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    autoSelect: true,
    minPriority: 7,
    templateId: 'reactivation_v1'
  })
});
```

---

## Running the Tagger

To populate analytics data, run the contact tagger:

```javascript
const { ContactTagger } = require('./contactTagger');

// Tag all contacts for a company
const tagger = new ContactTagger('0210', {
  verbose: true,
  aiEnabled: true
});

await tagger.tagAllContacts();

// Tag a single contact
await tagger.tagContact('0210-60123456789');
```

---

## Database Queries

### Find contacts stuck at specific stage
```sql
SELECT 
  contact_id, 
  name, 
  phone,
  custom_fields->'analytics'->>'last_response_stage' as stage,
  custom_fields->'analytics'->>'days_since_last_message' as days_dormant
FROM contacts
WHERE company_id = '0210'
  AND custom_fields->'analytics'->>'last_response_stage' = 'never_replied'
ORDER BY created_at DESC;
```

### Find high-priority reactivation candidates
```sql
SELECT 
  contact_id,
  name,
  phone,
  custom_fields->'analytics'->>'reactivation_priority' as priority
FROM contacts
WHERE company_id = '0210'
  AND custom_fields->'analytics'->>'reactivation_eligible' = 'true'
  AND (custom_fields->'analytics'->>'reactivation_priority')::numeric >= 8
ORDER BY (custom_fields->'analytics'->>'reactivation_priority')::numeric DESC;
```

---

## Notes

- Analytics data is updated every time the contact tagger runs
- All timestamps are in ISO 8601 format
- Response times are stored in seconds
- Engagement rates are decimal values (0.0 to 1.0)
- Priority scores range from 1-10 (higher = more priority)
- Tags are stored separately in the `tags` JSONB column
