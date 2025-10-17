-- =====================================================
-- Fix Tags Column Type Issues
-- Run this in your SQL editor to diagnose and fix
-- =====================================================

-- 1. Check current tags column type
SELECT
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_name = 'contacts'
AND column_name = 'tags';

-- Expected output:
-- column_name | data_type | udt_name
-- tags        | ARRAY     | _text
-- OR
-- tags        | text      | text  (if it's just text, we need to convert)

-- =====================================================
-- If tags column is JSONB or JSON (wrong type):
-- =====================================================

-- Backup existing data first!
-- CREATE TABLE contacts_backup AS SELECT * FROM contacts;

-- Drop and recreate as TEXT[] if it's JSON/JSONB
-- ALTER TABLE contacts DROP COLUMN tags;
-- ALTER TABLE contacts ADD COLUMN tags TEXT[];

-- =====================================================
-- If tags column is already TEXT[] but has bad data:
-- =====================================================

-- Check for contacts with problematic tags
SELECT
    contact_id,
    tags,
    pg_typeof(tags) as type
FROM contacts
WHERE company_id = '0210'
LIMIT 10;

-- Clean up any NULL or malformed tags
UPDATE contacts
SET tags = ARRAY[]::TEXT[]
WHERE tags IS NULL;

-- =====================================================
-- Test inserting tags manually
-- =====================================================

-- Test with a sample contact
UPDATE contacts
SET tags = ARRAY['active', 'hot-lead', 'query']::TEXT[]
WHERE contact_id = '0210-120363366268683798';

-- Verify it worked
SELECT contact_id, tags
FROM contacts
WHERE contact_id = '0210-120363366268683798';

-- Expected output:
-- contact_id                   | tags
-- 0210-120363366268683798      | {active,hot-lead,query}

-- =====================================================
-- If you need to convert existing comma-separated strings to arrays:
-- =====================================================

-- Only run if your tags are currently stored as "tag1,tag2,tag3" strings
-- UPDATE contacts
-- SET tags = string_to_array(tags, ',')::TEXT[]
-- WHERE tags IS NOT NULL
-- AND tags != ''
-- AND pg_typeof(tags) = 'text'::regtype;

-- =====================================================
-- Verify everything is working
-- =====================================================

-- Count contacts by tag (should work if arrays are set up correctly)
SELECT
    unnest(tags) as tag,
    COUNT(*) as count
FROM contacts
WHERE company_id = '0210'
GROUP BY tag
ORDER BY count DESC;
