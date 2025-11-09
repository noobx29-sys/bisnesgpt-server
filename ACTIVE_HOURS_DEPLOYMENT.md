# Active Hours Feature - Deployment Instructions

## Pre-Deployment Checklist

- [ ] Backup database
- [ ] Review all code changes
- [ ] Test in development environment
- [ ] Verify no breaking changes to existing functionality
- [ ] Notify frontend team of API changes

## Deployment Steps

### Step 1: Backup Database

```bash
# Create backup with timestamp
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump $DATABASE_URL > $BACKUP_FILE
echo "Backup created: $BACKUP_FILE"
```

### Step 2: Apply Database Migration

```bash
# Navigate to project directory
cd /path/to/bisnesgpt-server

# Apply migration
psql $DATABASE_URL -f migrations/add_active_hours_to_scheduled_messages.sql

# Verify columns were added
psql $DATABASE_URL -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'scheduled_messages' AND column_name IN ('active_hours_start', 'active_hours_end');"
```

Expected output:
```
     column_name      | data_type | is_nullable 
---------------------+-----------+-------------
 active_hours_start  | character varying | YES
 active_hours_end    | character varying | YES
```

### Step 3: Verify Indexes

```bash
psql $DATABASE_URL -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'scheduled_messages' AND indexname IN ('idx_active_hours', 'idx_status_scheduled_time');"
```

### Step 4: Deploy Code Changes

```bash
# Pull latest changes
git pull origin master

# Install dependencies (if any new ones)
npm install

# Restart server (using PM2 example)
pm2 restart bisnesgpt-server

# Check logs for startup
pm2 logs bisnesgpt-server --lines 50
```

### Step 5: Verify Deployment

#### Test 1: Check Server Status

```bash
curl http://localhost:3000/api/health
```

Expected: `200 OK`

#### Test 2: Verify Existing Messages Still Work

```bash
# Get existing scheduled messages
curl "http://localhost:3000/api/scheduled-messages?companyId=YOUR_TEST_COMPANY"
```

Verify response includes messages and they still have all fields.

#### Test 3: Create Message Without Active Hours

```bash
curl -X POST http://localhost:3000/api/schedule-message/YOUR_TEST_COMPANY \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test message without active hours",
    "chatIds": ["60123456789@c.us"],
    "scheduledTime": "2025-01-09T10:00:00.000Z"
  }'
```

Expected: `201 Created` with success response

#### Test 4: Create Message With Active Hours

```bash
curl -X POST http://localhost:3000/api/schedule-message/YOUR_TEST_COMPANY \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test message with active hours",
    "chatIds": ["60123456789@c.us"],
    "scheduledTime": "2025-01-09T10:00:00.000Z",
    "activeHours": {
      "start": "09:00",
      "end": "17:00"
    }
  }'
```

Expected: `201 Created` with success response

#### Test 5: Verify Active Hours in Database

```bash
psql $DATABASE_URL -c "SELECT id, message_content, active_hours_start, active_hours_end FROM scheduled_messages WHERE message_content LIKE 'Test message%' ORDER BY created_at DESC LIMIT 2;"
```

Expected output showing both test messages:
```
                  id                  |           message_content            | active_hours_start | active_hours_end 
--------------------------------------+-------------------------------------+--------------------+------------------
 xxx-xxx-xxx                          | Test message with active hours      | 09:00              | 17:00
 yyy-yyy-yyy                          | Test message without active hours   |                    |
```

#### Test 6: Test Invalid Active Hours

```bash
curl -X POST http://localhost:3000/api/schedule-message/YOUR_TEST_COMPANY \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Invalid test",
    "chatIds": ["60123456789@c.us"],
    "scheduledTime": "2025-01-09T10:00:00.000Z",
    "activeHours": {
      "start": "17:00",
      "end": "09:00"
    }
  }'
```

Expected: `400 Bad Request` with error message about start time being after end time

### Step 6: Monitor Production

Monitor logs for the first few hours after deployment:

```bash
# Watch for errors
pm2 logs bisnesgpt-server --err --lines 100

# Watch for active hours checks
pm2 logs bisnesgpt-server | grep "Active hours"

# Monitor scheduled message processing
pm2 logs bisnesgpt-server | grep "sendScheduledMessage"
```

### Step 7: Cleanup Test Data

```bash
# Remove test messages created during verification
psql $DATABASE_URL -c "DELETE FROM scheduled_messages WHERE message_content LIKE 'Test message%';"
```

## Rollback Procedure

If critical issues are found:

### Quick Rollback (Code Only)

```bash
# Revert to previous version
git revert HEAD
git push origin master

# Redeploy
pm2 restart bisnesgpt-server
```

Database columns can remain - they won't cause issues as they're nullable.

### Full Rollback (Including Database)

```bash
# Restore database from backup
psql $DATABASE_URL < $BACKUP_FILE

# Revert code
git revert HEAD
git push origin master

# Redeploy
pm2 restart bisnesgpt-server
```

## Post-Deployment Tasks

- [ ] Monitor error rates for 24 hours
- [ ] Check that existing scheduled messages are still sending
- [ ] Verify new messages with active hours are being respected
- [ ] Update API documentation for frontend team
- [ ] Train support team on new feature
- [ ] Update user documentation

## Monitoring Queries

Run these queries periodically to monitor the feature:

### Check Active Hours Usage

```sql
-- Count messages with active hours
SELECT 
  COUNT(*) as total_messages,
  COUNT(active_hours_start) as with_active_hours,
  COUNT(*) - COUNT(active_hours_start) as without_active_hours
FROM scheduled_messages
WHERE status = 'scheduled';
```

### Check for Issues

```sql
-- Messages with only one active hours field set (should be none)
SELECT id, company_id, active_hours_start, active_hours_end
FROM scheduled_messages
WHERE (active_hours_start IS NULL AND active_hours_end IS NOT NULL)
   OR (active_hours_start IS NOT NULL AND active_hours_end IS NULL);
```

### Monitor Delayed Messages

```sql
-- Messages that should have sent but might be waiting for active hours
SELECT 
  id, 
  company_id, 
  message_content,
  scheduled_time,
  active_hours_start,
  active_hours_end,
  status
FROM scheduled_messages
WHERE status = 'scheduled'
  AND scheduled_time < NOW()
  AND active_hours_start IS NOT NULL
ORDER BY scheduled_time
LIMIT 20;
```

## Troubleshooting

### Issue: Active hours validation failing

**Symptoms:** Getting 400 errors when creating messages with active hours

**Check:**
```bash
# Verify time format
curl -X POST http://localhost:3000/api/schedule-message/TEST \
  -H "Content-Type: application/json" \
  -d '{"message":"test","chatIds":["123@c.us"],"scheduledTime":"2025-01-09T10:00:00Z","activeHours":{"start":"09:00","end":"17:00"}}' -v
```

**Solution:** Ensure times are in HH:MM format with leading zeros

### Issue: Messages not sending during active hours

**Check logs:**
```bash
pm2 logs bisnesgpt-server | grep -A 5 "Active hours check"
```

**Verify:**
1. Server timezone is correct
2. Active hours are stored correctly in database
3. Current time is within the specified range

### Issue: Existing scheduled messages stopped working

**Check:**
```sql
-- Verify existing messages still have NULL active hours
SELECT id, message_content, active_hours_start, active_hours_end, status
FROM scheduled_messages
WHERE created_at < '2025-01-08'  -- Date before deployment
LIMIT 10;
```

**Solution:** Should all show NULL for active_hours columns. If not, rollback.

## Performance Monitoring

Monitor these metrics:

1. **Database query performance:**
   ```sql
   SELECT query, mean_exec_time, calls
   FROM pg_stat_statements
   WHERE query LIKE '%scheduled_messages%'
     AND query LIKE '%active_hours%'
   ORDER BY mean_exec_time DESC
   LIMIT 10;
   ```

2. **Index usage:**
   ```sql
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
   FROM pg_stat_user_indexes
   WHERE tablename = 'scheduled_messages'
     AND indexname IN ('idx_active_hours', 'idx_status_scheduled_time');
   ```

3. **Message processing rate:**
   - Compare before/after deployment
   - Should remain the same or improve

## Success Criteria

Deployment is successful if:

- ✅ No increase in error rates
- ✅ Existing scheduled messages continue to send
- ✅ New messages can be created with active hours
- ✅ Messages respect active hours restrictions
- ✅ GET endpoints return activeHours field
- ✅ Database queries perform well
- ✅ No memory leaks or resource issues

## Contact

For deployment issues:
- Backend Team Lead: [Contact]
- DevOps: [Contact]
- On-call Engineer: [Contact]

## Documentation References

- Implementation details: `ACTIVE_HOURS_IMPLEMENTATION.md`
- Frontend integration: `ACTIVE_HOURS_FRONTEND_GUIDE.md`
- Migration file: `migrations/add_active_hours_to_scheduled_messages.sql`
