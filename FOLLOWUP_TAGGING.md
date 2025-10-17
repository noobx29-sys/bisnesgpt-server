# Follow-up Sequence Tagging

The contact tagging system now automatically detects and tags contacts based on their follow-up template status.

## How It Works

The system queries your `scheduled_messages` table to check if contacts have:
1. **Active follow-up sequences** - Scheduled messages with `template_id`
2. **Completed sequences** - All template messages sent
3. **Responses during follow-up** - Contact replied after sequence started

## Follow-up Tags

### `followup-active`
- **Applied when:** Contact has scheduled messages with a `template_id`
- **Color:** Purple (#8B5CF6)
- **Use case:** See which contacts are currently in a nurture sequence

### `followup-completed`
- **Applied when:** All template messages have been sent (no more scheduled)
- **Color:** Green (#10B981)
- **Use case:** Identify contacts who finished the sequence

### `followup-responded`
- **Applied when:** Contact sent messages after the follow-up started
- **Color:** Bright Green (#22C55E)
- **Use case:** Find engaged contacts who replied during the sequence

## Detection Logic

```sql
-- Checks scheduled_messages table
SELECT template_id, status, COUNT(*)
FROM scheduled_messages
WHERE contact_id = ? AND company_id = ? AND template_id IS NOT NULL

-- Active: has status='scheduled' messages
-- Completed: all messages status='sent', none scheduled
-- Responded: contact messages after first template message sent
```

## Metrics Available

When you tag a contact, you'll also get:

```javascript
{
  hasActiveFollowup: true/false,
  hasCompletedFollowup: true/false,
  hasFollowupResponse: true/false,
  followupTemplateId: "uuid",
  followupProgress: "3/7" // sent/total messages
}
```

## Examples

### Tag a contact and see follow-up status

```bash
node tagCLI.js tag-one abc-123 +60123456789 --verbose
```

**Output:**
```
Tags: active, hot-lead, followup-active, followup-responded

Key Metrics:
  Follow-up Template: template-xyz-789
  Follow-up Progress: 3/7 messages sent
  Has Active Follow-up: true
  Responded During Follow-up: true
```

### Find all contacts in follow-up sequences

```bash
curl "http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-active"
```

### Find contacts who completed follow-up but didn't respond

```bash
curl "http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-completed&matchAll=false"
```

Then filter out those with `followup-responded` tag.

### Analytics - See follow-up performance

```bash
curl "http://localhost:3000/api/tags/analytics?companyId=abc-123"
```

**Response:**
```json
{
  "distributionByCategory": [
    {
      "name": "followup",
      "tags": [
        {"tag": "followup-active", "count": 150},
        {"tag": "followup-completed", "count": 75},
        {"tag": "followup-responded", "count": 45}
      ]
    }
  ]
}
```

**Analysis:**
- 150 contacts currently in sequences
- 75 completed the sequence
- 45 responded (30% response rate)

## Integration with Your blast/tag.js

The system automatically detects follow-ups - no code changes needed in `blast/tag.js`.

When you:
- **Start a template:** Contact gets `followup-active` tag
- **Contact replies:** Gets `followup-responded` tag
- **Sequence completes:** Gets `followup-completed`, loses `followup-active`
- **Remove template:** Loses all follow-up tags

## Use Cases

### 1. Find non-responders in active sequences
```bash
# Get contacts with followup-active but NOT followup-responded
curl "http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-active"
# Then filter for those WITHOUT followup-responded
```

### 2. Identify high-engagement sequences
```bash
# Get all who responded
curl "http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-responded"
```

### 3. Re-engage completed non-responders
```bash
# Get completed but didn't respond
curl "http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-completed"
# Filter out those with followup-responded
# Start a different template for these contacts
```

### 4. Monitor sequence performance
```bash
node tagCLI.js stats abc-123

# Output shows:
# followup-active: 150 contacts (engaged in sequence)
# followup-responded: 45 contacts (30% response rate)
# followup-completed: 75 contacts (50% completion rate)
```

## Automation Ideas

### Auto-tag all contacts daily
```javascript
const cron = require('node-cron');
const { ContactTagger } = require('./contactTagger');

// Run at 3 AM daily
cron.schedule('0 3 * * *', async () => {
  const tagger = new ContactTagger('your-company-id');
  await tagger.tagAllContacts();

  // Now follow-up tags are up-to-date
  console.log('Follow-up tags updated!');
});
```

### Alert on high response rate
```javascript
const result = await tagger.tagContact(contactId);

if (result.tags.toAdd.includes('followup-responded')) {
  await notifyTeam(`Contact ${contactId} responded to follow-up!`);

  // Maybe pause the sequence since they're engaged?
  // await pauseFollowupSequence(contactId);
}
```

### Different follow-up for non-responders
```javascript
const { ContactTagger } = require('./contactTagger');

async function checkCompletedSequences() {
  // Get contacts with completed sequences
  const response = await fetch(
    'http://localhost:3000/api/tags/search?companyId=abc-123&tags=followup-completed'
  );
  const contacts = await response.json();

  for (const contact of contacts.data.contacts) {
    // Check if they responded
    if (!contact.tags.includes('followup-responded')) {
      console.log(`${contact.name} completed sequence but didn't respond`);

      // Start a different "re-engagement" template
      // await startReEngagementTemplate(contact.contactId);
    }
  }
}
```

## Notes

- Tags update automatically when you run the tagger
- No changes needed to your existing `blast/tag.js` code
- Works by querying the `scheduled_messages` table
- Template info stored in metrics for reference
- Response detection compares message timestamps with template send times

---

**Pro Tip:** Run `node tagCLI.js tag-all <companyId> --dry-run` first to see what tags would be applied without making changes!
