-- =====================================================
-- Create Contact Tagging Tables
-- Simplified version for your existing schema
-- =====================================================

-- Table: contact_tag_history
-- Purpose: Track all tag changes for audit and analytics
CREATE TABLE IF NOT EXISTS contact_tag_history (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  contact_id VARCHAR(255) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'added' or 'removed'
  method VARCHAR(20) NOT NULL, -- 'auto', 'manual', 'ai', 'rule'
  reason TEXT,
  confidence DECIMAL(3,2),
  metadata JSONB,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_contact ON contact_tag_history(contact_id, company_id);
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_tag ON contact_tag_history(tag);
CREATE INDEX IF NOT EXISTS idx_contact_tag_history_created ON contact_tag_history(created_at DESC);

-- Table: contact_tag_analytics
-- Purpose: Store pre-computed analytics
CREATE TABLE IF NOT EXISTS contact_tag_analytics (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  tag VARCHAR(100) NOT NULL,
  contact_count INTEGER DEFAULT 0,
  added_count INTEGER DEFAULT 0,
  removed_count INTEGER DEFAULT 0,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, tag, date)
);

-- Index for analytics
CREATE INDEX IF NOT EXISTS idx_tag_analytics_company_date ON contact_tag_analytics(company_id, date DESC);

-- Table: tag_definitions
-- Purpose: Store tag configurations
CREATE TABLE IF NOT EXISTS tag_definitions (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255),
  tag_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  color VARCHAR(7),
  rules JSONB,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, tag_name)
);

-- Index for tag definitions
CREATE INDEX IF NOT EXISTS idx_tag_definitions_company ON tag_definitions(company_id);

-- Insert default system tags
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

-- Follow-up Tags
(NULL, 'followup-active', 'followup', 'Currently in a follow-up sequence', '#8B5CF6', true, 85),
(NULL, 'followup-completed', 'followup', 'Completed follow-up sequence', '#10B981', true, 75),
(NULL, 'followup-responded', 'followup', 'Responded during follow-up sequence', '#22C55E', true, 80)
ON CONFLICT (company_id, tag_name) DO NOTHING;

-- Success message
SELECT 'Contact tagging tables created successfully!' as status;

-- Note: To differentiate groups from leads, the system will:
-- 1. Check if contact_id ends with @g.us (group) or @c.us (individual)
-- 2. Only tag contacts with @c.us (individual leads)
-- 3. Skip all group chats from tagging
