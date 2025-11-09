# Active Hours API - Frontend Integration Guide

## Quick Start

The Active Hours feature allows scheduled messages to only be sent within specified time windows each day.

## API Changes

### Creating Scheduled Messages

**Endpoint:** `POST /api/schedule-message/:companyId`

Add optional `activeHours` to your request:

```javascript
const response = await fetch(`/api/schedule-message/${companyId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Hello!",
    chatIds: ["60123456789@c.us"],
    scheduledTime: "2025-01-08T10:00:00.000Z",
    // ... other fields ...
    
    // NEW: Optional active hours
    activeHours: {
      start: "09:00",  // 9 AM (24-hour format)
      end: "17:00"     // 5 PM (24-hour format)
    }
  })
});
```

**Format Requirements:**
- Both `start` and `end` must be provided together (or both omitted)
- Format: `"HH:MM"` in 24-hour notation
- Must have leading zeros: `"09:00"` not `"9:00"`
- `start` must be before `end` (no overnight ranges)
- Valid range: `"00:00"` to `"23:59"`

**Examples:**
```javascript
// Valid
{ start: "09:00", end: "17:00" }  // 9 AM to 5 PM
{ start: "08:30", end: "18:30" }  // 8:30 AM to 6:30 PM
{ start: "00:00", end: "23:59" }  // All day

// Invalid
{ start: "9:00", end: "17:00" }   // ❌ Missing leading zero
{ start: "17:00", end: "09:00" }  // ❌ Start after end (overnight not supported)
{ start: "25:00", end: "17:00" }  // ❌ Invalid hour
{ start: "09:00" }                // ❌ Missing end time
```

### Updating Scheduled Messages

**Endpoint:** `PUT /api/schedule-message/:companyId/:messageId`

Same format as POST - include `activeHours` to update:

```javascript
const response = await fetch(`/api/schedule-message/${companyId}/${messageId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Updated message",
    // ... other fields ...
    
    activeHours: {
      start: "10:00",
      end: "16:00"
    }
  })
});
```

To remove active hours, send `null` or omit the field.

### Getting Scheduled Messages

**Endpoint:** `GET /api/scheduled-messages?companyId={companyId}`

Response now includes `activeHours` for each message:

```javascript
{
  "success": true,
  "messages": [
    {
      "id": "msg_123",
      "messageContent": "Hello!",
      "scheduledTime": "2025-01-08T10:00:00.000Z",
      "status": "scheduled",
      
      // NEW: Active hours (null if not set)
      "activeHours": {
        "start": "09:00",
        "end": "17:00"
      }
      // ... other fields ...
    }
  ]
}
```

If `activeHours` is `null`, the message can be sent at any time.

## UI Components

### Time Picker Component

Recommended implementation:

```typescript
interface ActiveHours {
  start: string;  // "HH:MM"
  end: string;    // "HH:MM"
}

function ActiveHoursSelector({ 
  value, 
  onChange 
}: { 
  value: ActiveHours | null; 
  onChange: (hours: ActiveHours | null) => void;
}) {
  const [enabled, setEnabled] = useState(value !== null);
  const [start, setStart] = useState(value?.start || "09:00");
  const [end, setEnd] = useState(value?.end || "17:00");

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    onChange(checked ? { start, end } : null);
  };

  const handleStartChange = (newStart: string) => {
    setStart(newStart);
    if (enabled) {
      onChange({ start: newStart, end });
    }
  };

  const handleEndChange = (newEnd: string) => {
    setEnd(newEnd);
    if (enabled) {
      onChange({ start, end: newEnd });
    }
  };

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        Restrict to active hours
      </label>
      
      {enabled && (
        <div>
          <label>
            Start:
            <input
              type="time"
              value={start}
              onChange={(e) => handleStartChange(e.target.value)}
            />
          </label>
          
          <label>
            End:
            <input
              type="time"
              value={end}
              onChange={(e) => handleEndChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
```

### Display Component

Show active hours in message list:

```typescript
function MessageCard({ message }: { message: ScheduledMessage }) {
  return (
    <div className="message-card">
      <h3>{message.messageContent}</h3>
      <p>Scheduled: {formatDate(message.scheduledTime)}</p>
      
      {message.activeHours && (
        <p className="active-hours">
          📅 Active hours: {message.activeHours.start} - {message.activeHours.end}
        </p>
      )}
      
      <span className={`status ${message.status}`}>
        {message.status}
      </span>
    </div>
  );
}
```

### Format Helper Functions

```typescript
// Ensure time is in HH:MM format with leading zeros
function normalizeTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

// Validate time format
function isValidTime(time: string): boolean {
  const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return regex.test(time);
}

// Validate active hours
function validateActiveHours(start: string, end: string): string | null {
  if (!isValidTime(start)) {
    return "Invalid start time format. Use HH:MM (24-hour format).";
  }
  
  if (!isValidTime(end)) {
    return "Invalid end time format. Use HH:MM (24-hour format).";
  }
  
  if (start >= end) {
    return "Start time must be before end time.";
  }
  
  return null; // Valid
}

// Format for display (convert to 12-hour format if needed)
function formatTimeForDisplay(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}
```

## Error Handling

Handle validation errors from the API:

```typescript
async function createScheduledMessage(data: ScheduledMessageData) {
  try {
    const response = await fetch(`/api/schedule-message/${companyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      // Handle validation errors
      if (response.status === 400) {
        toast.error(result.error || "Invalid active hours");
        return;
      }
      throw new Error(result.error || "Failed to schedule message");
    }
    
    toast.success("Message scheduled successfully!");
    return result;
    
  } catch (error) {
    console.error("Error scheduling message:", error);
    toast.error("Failed to schedule message");
  }
}
```

## TypeScript Types

```typescript
interface ActiveHours {
  start: string;  // "HH:MM" format
  end: string;    // "HH:MM" format
}

interface ScheduledMessage {
  id: string;
  scheduleId: string;
  companyId: string;
  messageContent: string;
  scheduledTime: string;  // ISO date string
  status: 'scheduled' | 'sent' | 'failed' | 'stopped';
  activeHours: ActiveHours | null;
  // ... other fields
}

interface CreateScheduledMessageRequest {
  message: string;
  chatIds: string[];
  scheduledTime: string;  // ISO date string
  activeHours?: ActiveHours | null;
  // ... other fields
}

interface ScheduledMessagesResponse {
  success: boolean;
  messages: ScheduledMessage[];
  count: number;
}
```

## Best Practices

1. **Always validate before sending:**
   ```typescript
   if (activeHours) {
     const error = validateActiveHours(activeHours.start, activeHours.end);
     if (error) {
       toast.error(error);
       return;
     }
   }
   ```

2. **Normalize times before sending:**
   ```typescript
   if (activeHours) {
     activeHours = {
       start: normalizeTime(activeHours.start),
       end: normalizeTime(activeHours.end)
     };
   }
   ```

3. **Provide clear user feedback:**
   - Show when message will be sent
   - Explain active hours restriction
   - Warn if scheduled time is outside active hours

4. **Handle edge cases:**
   - User's timezone vs server timezone
   - Overnight ranges (not supported - show warning)
   - Multiple day campaigns

## Example Form Implementation

```typescript
function ScheduleMessageForm() {
  const [formData, setFormData] = useState({
    message: "",
    scheduledTime: new Date(),
    activeHours: null as ActiveHours | null
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate active hours if provided
    if (formData.activeHours) {
      const error = validateActiveHours(
        formData.activeHours.start,
        formData.activeHours.end
      );
      if (error) {
        toast.error(error);
        return;
      }
    }
    
    // Normalize times
    const dataToSend = {
      ...formData,
      activeHours: formData.activeHours ? {
        start: normalizeTime(formData.activeHours.start),
        end: normalizeTime(formData.activeHours.end)
      } : null
    };
    
    await createScheduledMessage(dataToSend);
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={formData.message}
        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
        placeholder="Enter message..."
      />
      
      <input
        type="datetime-local"
        value={formData.scheduledTime.toISOString().slice(0, 16)}
        onChange={(e) => setFormData({ 
          ...formData, 
          scheduledTime: new Date(e.target.value) 
        })}
      />
      
      <ActiveHoursSelector
        value={formData.activeHours}
        onChange={(hours) => setFormData({ ...formData, activeHours: hours })}
      />
      
      <button type="submit">Schedule Message</button>
    </form>
  );
}
```

## Testing Checklist

- [ ] Create message with active hours
- [ ] Create message without active hours (legacy behavior)
- [ ] Update message to add active hours
- [ ] Update message to remove active hours
- [ ] Display active hours in message list
- [ ] Validate invalid time formats
- [ ] Validate start >= end
- [ ] Handle API errors gracefully
- [ ] Test with different timezones

## Support

For backend issues or questions:
- Check `ACTIVE_HOURS_IMPLEMENTATION.md` for technical details
- Review server logs for debugging
- Contact backend team

For frontend issues:
- Verify request format matches examples above
- Check browser console for errors
- Test with API directly using cURL/Postman
