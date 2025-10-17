-- Migration: Contact Tagging System
-- Description: Creates tables for automated contact tagging and classification
-- Date: 2025-10-16

-- =====================================================
-- Table: tag_definitions
-- Purpose: Store tag configurations and rules per company
-- =====================================================
CREATE TABLE IF NOT EXISTS tag_definitions (
  id SERIAL PRIMARY KEY,
  company_id UUID,
  tag_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'status', 'engagement', 'behavioral', 'action'
  description TEXT,
  color VARCHAR(7), -- Hex color for UI display
  rules JSONB, -- Automation rules in JSON format
  priority INTEGER DEFAULT 0, -- Higher priority tags are checked first
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false, -- System tags cannot be deleted
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, tag_name)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tag_definitions_company ON tag_definitions(company_id);
CREATE INDEX IF NOT EXISTS idx_tag_definitions_active ON tag_definitions(is_active);

-- =====================================================
-- Table: contact_tag_history
-- Purpose: Track all tag changes for audit and analytics
-- =====================================================
CREATE TABLE IF NOT EXISTS contact_tag_history (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL,
  contact_id VARCHAR(255) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'added' or 'removed'
  method VARCHAR(20) NOT NULL, -- 'auto', 'manual', 'ai', 'rule'
  reason TEXT, -- Why tag was applied/removed
  confidence DECIMAL(3,2), -- AI confidence score (0.00-1.00)
  metadata JSONB, -- Additional context (e.g., message_id, rule_id)
  created_by VARCHAR(100), -- User ID if manual
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_contact ON contact_tag_history(contact_id, company_id);
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_tag ON contact_tag_history(tag);
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_created ON contact_tag_history(created_at DESC);

-- =====================================================
-- Table: contact_tag_analytics
-- Purpose: Store pre-computed analytics for dashboard
-- =====================================================
CREATE TABLE IF NOT EXISTS contact_tag_analytics (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL,
  tag VARCHAR(100) NOT NULL,
  contact_count INTEGER DEFAULT 0,
  added_count INTEGER DEFAULT 0, -- Times tag was added today
  removed_count INTEGER DEFAULT 0, -- Times tag was removed today
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, tag, date)
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_tag_analytics_company_date ON contact_tag_analytics(company_id, date DESC);

-- =====================================================
-- Table: contact_tagging_queue
-- Purpose: Queue for contacts that need re-tagging
-- =====================================================
CREATE TABLE IF NOT EXISTS contact_tagging_queue (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL,
  contact_id VARCHAR(255) NOT NULL,
  priority INTEGER DEFAULT 0, -- Higher priority processed first
  reason VARCHAR(100), -- Why queued (e.g., 'new_message', 'scheduled', 'manual')
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE(company_id, contact_id, status)
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_tagging_queue_status ON contact_tagging_queue(status, priority DESC, created_at ASC);

-- =====================================================
-- Insert Default System Tags
-- =====================================================
-- Note: These will be inserted for each company when they first use the system
-- For now, creating global defaults (company_id = NULL means system-wide)

INSERT INTO tag_definitions (company_id, tag_name, category, description, color, is_system, priority) VALUES
-- Status Tags
(NULL, 'new', 'status', 'New contact with no interaction yet', '#3B82F6', true, 100),
(NULL, 'active', 'status', 'Currently in active conversation', '#10B981', true, 90),
(NULL, 'query', 'status', 'Has pending questions or inquiries', '#F59E0B', true, 85),
(NULL, 'closed', 'status', 'Conversation completed or resolved', '#6B7280', true, 80),
(NULL, 'dormant', 'status', 'No activity in last 30 days', '#9CA3AF', true, 70),
(NULL, 'cold', 'status', 'No response to multiple outreach attempts', '#374151', true, 60),

-- Engagement Tags
(NULL, 'hot-lead', 'engagement', 'High engagement with quick responses', '#EF4444', true, 95),
(NULL, 'warm-lead', 'engagement', 'Moderate engagement level', '#F59E0B', true, 85),
(NULL, 'cold-lead', 'engagement', 'Low engagement or unresponsive', '#3B82F6', true, 75),
(NULL, 'interested', 'engagement', 'Showing buying signals or interest', '#10B981', true, 88),
(NULL, 'not-interested', 'engagement', 'Expressed lack of interest', '#6B7280', true, 65),

-- Behavioral Tags
(NULL, 'quick-responder', 'behavioral', 'Average response time under 1 hour', '#8B5CF6', true, 80),
(NULL, 'slow-responder', 'behavioral', 'Average response time over 24 hours', '#EC4899', true, 70),
(NULL, 'night-owl', 'behavioral', 'Active during night hours (10PM-6AM)', '#6366F1', true, 60),
(NULL, 'business-hours', 'behavioral', 'Active during business hours (9AM-5PM)', '#14B8A6', true, 60),
(NULL, 'weekend-active', 'behavioral', 'Active on weekends', '#F97316', true, 55),

-- Action Tags
(NULL, 'follow-up-needed', 'action', 'Requires follow-up action', '#DC2626', true, 100),
(NULL, 'awaiting-response', 'action', 'Waiting for their reply', '#FBBF24', true, 90),
(NULL, 'needs-attention', 'action', 'Flagged for manual review', '#EF4444', true, 95),
(NULL, 'vip', 'action', 'High-value or priority contact', '#7C3AED', true, 100),

-- Follow-up Tags (automatically detected from scheduled_messages table)
(NULL, 'followup-active', 'followup', 'Currently in a follow-up sequence', '#8B5CF6', true, 85),
(NULL, 'followup-completed', 'followup', 'Completed follow-up sequence', '#10B981', true, 75),
(NULL, 'followup-responded', 'followup', 'Responded during follow-up sequence', '#22C55E', true, 80)
ON CONFLICT (company_id, tag_name) DO NOTHING;

-- =====================================================
-- Functions and Triggers
-- =====================================================

-- Function to update tag analytics when tags are added/removed
CREATE OR REPLACE FUNCTION update_tag_analytics()
RETURNS TRIGGER AS $$
BEGIN
  -- Update or insert analytics record
  INSERT INTO contact_tag_analytics (company_id, tag, contact_count, added_count, removed_count, date)
  VALUES (
    NEW.company_id,
    NEW.tag,
    CASE WHEN NEW.action = 'added' THEN 1 ELSE 0 END,
    CASE WHEN NEW.action = 'added' THEN 1 ELSE 0 END,
    CASE WHEN NEW.action = 'removed' THEN 1 ELSE 0 END,
    CURRENT_DATE
  )
  ON CONFLICT (company_id, tag, date) DO UPDATE SET
    added_count = contact_tag_analytics.added_count + (CASE WHEN NEW.action = 'added' THEN 1 ELSE 0 END),
    removed_count = contact_tag_analytics.removed_count + (CASE WHEN NEW.action = 'removed' THEN 1 ELSE 0 END),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update analytics on tag history insert
CREATE TRIGGER trigger_update_tag_analytics
AFTER INSERT ON contact_tag_history
FOR EACH ROW
EXECUTE FUNCTION update_tag_analytics();

-- =====================================================
-- Helpful Views
-- =====================================================

-- View: Active contacts by tag
CREATE OR REPLACE VIEW v_contacts_by_tag AS
SELECT
  c.company_id,
  c.contact_id,
  c.phone,
  c.name,
  unnest(string_to_array(c.tags, ',')) as tag,
  c.last_updated
FROM contacts c
WHERE c.tags IS NOT NULL AND c.tags != '';

-- View: Tag summary by company
CREATE OR REPLACE VIEW v_tag_summary AS
SELECT
  company_id,
  unnest(string_to_array(tags, ',')) as tag,
  COUNT(*) as contact_count
FROM contacts
WHERE tags IS NOT NULL AND tags != ''
GROUP BY company_id, tag
ORDER BY company_id, contact_count DESC;

-- =====================================================
-- Grant Permissions (adjust as needed)
-- =====================================================
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

COMMENT ON TABLE tag_definitions IS 'Stores tag configurations and automation rules per company';
COMMENT ON TABLE contact_tag_history IS 'Audit trail of all tag additions and removals';
COMMENT ON TABLE contact_tag_analytics IS 'Pre-computed analytics for tag distribution';
COMMENT ON TABLE contact_tagging_queue IS 'Queue for async contact tagging operations';
