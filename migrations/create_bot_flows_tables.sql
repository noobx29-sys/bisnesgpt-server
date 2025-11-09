-- Bot Mode Backend Migration
-- Creates tables and columns needed for Bot Mode feature
-- Run this migration to enable Bot Mode functionality

-- ============================================
-- 1. Create bot_flows table
-- ============================================
CREATE TABLE IF NOT EXISTS bot_flows (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(500) NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bot_flows_company_id ON bot_flows(company_id);

-- Add comment for documentation
COMMENT ON TABLE bot_flows IS 'Stores bot flow configurations for each company';
COMMENT ON COLUMN bot_flows.nodes IS 'Array of flow nodes (blocks) in JSON format';
COMMENT ON COLUMN bot_flows.edges IS 'Array of connections between nodes in JSON format';

-- ============================================
-- 2. Add bot_mode column to companies table
-- ============================================
-- Add bot_mode column if it doesn't exist
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bot_mode VARCHAR(20) DEFAULT 'ai';

-- Create index on bot_mode for faster queries
CREATE INDEX IF NOT EXISTS idx_companies_bot_mode ON companies(bot_mode);

-- Add constraint to ensure only valid modes
ALTER TABLE companies 
  DROP CONSTRAINT IF EXISTS check_bot_mode_valid;

ALTER TABLE companies 
  ADD CONSTRAINT check_bot_mode_valid 
  CHECK (bot_mode IN ('ai', 'bot'));

-- Add comment for documentation
COMMENT ON COLUMN companies.bot_mode IS 'Bot operation mode: ai (AI-powered) or bot (flow-based)';

-- ============================================
-- 3. Create bot_flow_executions table (optional - for logging)
-- ============================================
CREATE TABLE IF NOT EXISTS bot_flow_executions (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  contact_id VARCHAR(255) NOT NULL,
  flow_id INTEGER REFERENCES bot_flows(id),
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'running',
  error_message TEXT,
  nodes_executed JSONB DEFAULT '[]',
  variables_final JSONB DEFAULT '{}'
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bot_flow_executions_company_id ON bot_flow_executions(company_id);
CREATE INDEX IF NOT EXISTS idx_bot_flow_executions_status ON bot_flow_executions(status);
CREATE INDEX IF NOT EXISTS idx_bot_flow_executions_started_at ON bot_flow_executions(started_at);

-- Add comment for documentation
COMMENT ON TABLE bot_flow_executions IS 'Logs bot flow execution history for debugging and analytics';

-- ============================================
-- 4. Verify migration success
-- ============================================
-- Query to check if everything was created successfully
DO $$
BEGIN
  RAISE NOTICE 'Bot Mode Migration Complete!';
  RAISE NOTICE 'Tables created: bot_flows, bot_flow_executions';
  RAISE NOTICE 'Column added: companies.bot_mode';
  RAISE NOTICE 'Indexes created: 5 indexes';
END $$;
