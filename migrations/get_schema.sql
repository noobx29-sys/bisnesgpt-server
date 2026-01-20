-- =====================================================
-- Get Complete Database Schema
-- Run this in your SQL editor to see all table structures
-- =====================================================

-- 1. Get all tables in the database
SELECT 
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Get contacts table structure
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'contacts'
ORDER BY ordinal_position;

-- 3. Get messages table structure
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'messages'
ORDER BY ordinal_position;

-- 4. Get scheduled_messages table structure (if exists)
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'scheduled_messages'
ORDER BY ordinal_position;

-- 5. Get contact_tag_history table structure (if exists)
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'contact_tag_history'
ORDER BY ordinal_position;

-- 6. Sample data from contacts table (to see what fields are populated)
SELECT 
    contact_id,
    phone,
    name,
    tags,
    last_updated,
    assigned_to,
    created_at,
    thread_id,
    company_id
FROM contacts
LIMIT 5;

-- 7. Sample data from messages table
SELECT 
    message_id,
    contact_id,
    content,
    from_me,
    timestamp,
    company_id
FROM messages
ORDER BY timestamp DESC
LIMIT 10;

-- 8. Sample data from scheduled_messages (if exists)
SELECT 
    id,
    company_id,
    contact_id,
    template_id,
    status,
    scheduled_time,
    sent_at,
    message_content
FROM scheduled_messages
WHERE template_id IS NOT NULL
ORDER BY scheduled_time DESC
LIMIT 10;

-- 9. Check indexes on contacts table
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'contacts';

-- 10. Check indexes on messages table
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'messages';
