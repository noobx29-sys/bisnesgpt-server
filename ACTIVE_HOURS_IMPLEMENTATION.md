# Active Hours Implementation Summary

## Overview
This document describes the implementation of the Active Hours feature for scheduled messages, which restricts message sending to specific time windows each day.

## Implementation Date
January 8, 2025

## Changes Made

### 1. Database Schema Changes

**File:** `migrations/add_active_hours_to_scheduled_messages.sql`

- Added two new columns to `scheduled_messages` table:
  - `active_hours_start` (VARCHAR(5), nullable) - Start time in HH:MM format (24-hour)
  - `active_hours_end` (VARCHAR(5), nullable) - End time in HH:MM format (24-hour)
- Added indexes for better query performance:
  - `idx_active_hours` on (active_hours_start, active_hours_end)
  - `idx_status_scheduled_time` on (status, scheduled_time)

**To apply migration:**
```bash
psql $DATABASE_URL -f migrations/add_active_hours_to_scheduled_messages.sql
```

### 2. Helper Functions Added

**File:** `server.js` (around line 11228)

Four new utility functions were added:

#### `validateTimeFormat(time)`
- Validates time string format (HH:MM in 24-hour format)
- Returns boolean indicating if format is valid
- Regex pattern: `/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/`

#### `validateActiveHours(start, end)`
- Validates active hours constraints
- Checks if both start and end are provided together
- Validates time format for both values
- Ensures start time is before end time (no overnight ranges)
- Returns object: `{ valid: boolean, error?: string }`

#### `isWithinActiveHours(message)`
- Checks if current time is within active hours
- Returns true if no active hours are set (backwards compatible)
- Compares current time string with start/end times
- Returns boolean

#### `normalizeTimeFormat(time)`
- Normalizes time format to HH:MM with leading zeros
- Example: "9:30" becomes "09:30"
- Returns normalized string or null

### 3. API Endpoint Updates

#### POST `/api/schedule-message/:companyId`

**Changes:**
- Added validation for optional `activeHours` object in request body
- Request body now accepts:
  ```json
  {
    "activeHours": {
      "start": "09:00",
      "end": "17:00"
    }
  }
  ```
- Validates and normalizes active hours before saving
- Returns 400 error with descriptive message if validation fails
- Stores values in `active_hours_start` and `active_hours_end` columns
- Also updates batch message inserts to include active hours

**Validation:**
- Both start and end must be provided together
- Format must be HH:MM in 24-hour notation
- Start time must be before end time
- Overnight ranges are not supported

#### PUT `/api/schedule-message/:companyId/:messageId`

**Changes:**
- Added validation for `activeHours` in update request
- Updates `active_hours_start` and `active_hours_end` columns
- Same validation rules as POST endpoint
- Updates all messages with the same schedule_id

#### GET `/api/scheduled-messages`

**Changes:**
- Added `active_hours_start` and `active_hours_end` to SELECT query
- Response now includes `activeHours` object in each message:
  ```json
  {
    "id": "...",
    "activeHours": {
      "start": "09:00",
      "end": "17:00"
    }
  }
  ```
- Returns null for `activeHours` if not set

#### GET `/api/scheduled-messages/contact`

**Changes:**
- Added same `activeHours` support as main GET endpoint
- Includes active hours in response for contact-specific scheduled messages

### 4. Message Scheduler Updates

**File:** `server.js` - `sendScheduledMessage()` function (around line 11860)

**Changes:**
- Updated `isWithinActiveHoursLocal()` helper function to use new database columns
- Now checks `message.active_hours_start` and `message.active_hours_end` directly
- Uses string comparison of HH:MM format times
- Enhanced logging to show active hours range when skipping messages
- Message loop checks active hours before processing each batch
- If outside active hours, waits 10 minutes before checking again

**Behavior:**
- Messages scheduled outside active hours remain in "scheduled" status
- Scheduler checks every 10 minutes if currently outside active hours
- Once active hours begin, messages are sent immediately
- No automatic rescheduling - messages wait until active hours

### 5. Logging Enhancements

Added comprehensive logging throughout:

**Validation Logging:**
- Logs when active hours are validated during message creation/update
- Shows normalized time values

**Scheduler Logging:**
- Logs when checking active hours status
- Shows current time vs. active hours range
- Logs when messages are skipped due to being outside active hours
- Shows wait time until next check

**Example Log Output:**
```
[Company 001] Active hours validated: { start: '09:00', end: '17:00' }
[Company 001] Active hours check (using columns): {
  currentTime: '08:30',
  startTime: '09:00',
  endTime: '17:00',
  isActive: false
}
[Company 001] Outside active hours (09:00 - 17:00), waiting 10 minutes...
```

## Backwards Compatibility

The implementation is fully backwards compatible:

1. **Database columns are nullable** - Existing scheduled messages without active hours continue to work
2. **Default behavior preserved** - If no active hours set, messages can be sent at any time
3. **API is optional** - activeHours field in request body is optional
4. **Scheduler falls back** - If active_hours_start/end are null, no time restrictions apply

## Testing Recommendations

### Unit Tests Needed

1. **Validation Tests:**
   - Valid time formats (09:00, 23:59)
   - Invalid time formats (25:00, 9:00, 09:60)
   - Start >= end (should fail)
   - Only start or only end provided (should fail)

2. **Active Hours Check Tests:**
   - Within active hours
   - Before active hours
   - After active hours
   - No active hours set (should always return true)

### Integration Tests Needed

1. **API Tests:**
   - POST with valid activeHours
   - POST without activeHours
   - POST with invalid activeHours (expect 400 error)
   - PUT to update activeHours
   - GET returns activeHours correctly

2. **Scheduler Tests:**
   - Message sent within active hours
   - Message skipped outside active hours
   - Message sent when active hours begin
   - Infinite loop respects active hours each day

### Manual Testing Steps

1. **Create scheduled message with active hours:**
   ```bash
   curl -X POST http://localhost:3000/api/schedule-message/TEST_COMPANY \
     -H "Content-Type: application/json" \
     -d '{
       "message": "Test message",
       "chatIds": ["60123456789@c.us"],
       "scheduledTime": "2025-01-08T10:00:00.000Z",
       "activeHours": {
         "start": "09:00",
         "end": "17:00"
       }
     }'
   ```

2. **Verify in database:**
   ```sql
   SELECT id, message_content, active_hours_start, active_hours_end, scheduled_time 
   FROM scheduled_messages 
   WHERE company_id = 'TEST_COMPANY';
   ```

3. **Test scheduler behavior:**
   - Schedule message outside active hours
   - Monitor logs to confirm it waits
   - Verify message sends when active hours begin

4. **Test GET endpoint:**
   ```bash
   curl http://localhost:3000/api/scheduled-messages?companyId=TEST_COMPANY
   ```
   Verify response includes activeHours object

## Known Limitations

1. **No overnight ranges** - Cannot set active hours like "22:00 - 02:00" (10 PM to 2 AM next day)
2. **No timezone configuration** - Active hours use server's local time
3. **10-minute check interval** - Messages may be delayed up to 10 minutes after active hours start
4. **Same active hours for all messages** - Cannot have different active hours for different message types

## Future Enhancements

1. **Timezone support** - Store company timezone and check active hours in that timezone
2. **Overnight ranges** - Support active hours that span midnight
3. **Day-specific active hours** - Different hours for weekdays vs weekends
4. **Multiple active hour windows** - Allow multiple time ranges per day
5. **Auto-reschedule** - Automatically reschedule messages to next active hours window
6. **Pause/resume** - Option to pause entire campaign when outside active hours

## Migration Guide

### For Existing Deployments

1. **Backup database:**
   ```bash
   pg_dump $DATABASE_URL > backup_before_active_hours.sql
   ```

2. **Apply migration:**
   ```bash
   psql $DATABASE_URL -f migrations/add_active_hours_to_scheduled_messages.sql
   ```

3. **Deploy code changes:**
   - Pull latest code
   - Restart server
   - Monitor logs for any issues

4. **Verify:**
   - Check existing scheduled messages still work
   - Test creating new message with active hours
   - Confirm GET endpoints return activeHours field

### Rollback Plan

If issues arise:

1. **Revert code changes** (Git revert)
2. **Database columns can remain** - They are nullable and won't break anything
3. **Or remove columns:**
   ```sql
   ALTER TABLE scheduled_messages 
   DROP COLUMN IF EXISTS active_hours_start,
   DROP COLUMN IF EXISTS active_hours_end;
   
   DROP INDEX IF EXISTS idx_active_hours;
   ```

## Configuration

No configuration changes required. Feature is opt-in per scheduled message.

## Performance Considerations

- Added indexes should improve query performance
- Active hours check is simple string comparison (fast)
- 10-minute wait loop when outside active hours reduces database load
- No impact on messages without active hours (backward compatible)

## Security Considerations

- Input validation prevents SQL injection (parameterized queries used)
- Time format validation prevents malformed data
- No authentication changes needed

## Support & Troubleshooting

### Common Issues

**Issue:** Messages not sending during active hours
- Check server timezone matches expected timezone
- Verify active_hours_start and active_hours_end in database
- Check logs for "Active hours check" messages
- Ensure time format is HH:MM (with leading zeros)

**Issue:** Validation error when creating message
- Ensure both start and end times provided
- Verify format is HH:MM (24-hour)
- Check that start < end
- No spaces or extra characters in time strings

**Issue:** Active hours not showing in GET response
- Verify database columns have data
- Check both active_hours_start AND active_hours_end are set
- Update to latest code version

### Debug Queries

```sql
-- Check scheduled messages with active hours
SELECT id, company_id, message_content, active_hours_start, active_hours_end, scheduled_time, status
FROM scheduled_messages
WHERE active_hours_start IS NOT NULL
ORDER BY scheduled_time DESC
LIMIT 10;

-- Count messages with active hours by company
SELECT company_id, COUNT(*) as count
FROM scheduled_messages
WHERE active_hours_start IS NOT NULL
GROUP BY company_id;

-- Find messages scheduled outside their active hours
SELECT id, company_id, scheduled_time, active_hours_start, active_hours_end
FROM scheduled_messages
WHERE active_hours_start IS NOT NULL
AND EXTRACT(HOUR FROM scheduled_time)::text || ':' || LPAD(EXTRACT(MINUTE FROM scheduled_time)::text, 2, '0') NOT BETWEEN active_hours_start AND active_hours_end;
```

## Contact

For questions or issues:
- Check server logs first
- Review this documentation
- Contact backend development team

## References

- Original requirements: `API_DOCUMENTATION.md` (Active Hours section)
- Database migration: `migrations/add_active_hours_to_scheduled_messages.sql`
- Main implementation: `server.js` (search for "ACTIVE HOURS")
