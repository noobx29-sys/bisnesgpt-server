-- Migration: Create monitored_companies table
-- This table stores the list of company IDs that should be:
-- 1. Displayed on the status page
-- 2. Initialized with WWebJS when server starts (unless they have Meta API configured)

CREATE TABLE IF NOT EXISTS monitored_companies (
    id SERIAL PRIMARY KEY,
    company_id VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_monitored_companies_company_id ON monitored_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_monitored_companies_active ON monitored_companies(is_active);

-- Insert default monitored companies
INSERT INTO monitored_companies (company_id, notes) VALUES
    ('0101', 'Default company'),
    ('0107', 'Default company'),
    ('128137', 'Default company'),
    ('0149', 'Default company'),
    ('0156', 'Default company'),
    ('0160', 'Default company'),
    ('0161', 'Default company'),
    ('0210', 'Default company'),
    ('621275', 'Default company'),
    ('0245', 'Default company'),
    ('0342', 'Default company'),
    ('0377', 'Default company'),
    ('049815', 'Default company'),
    ('058666', 'Default company'),
    ('063', 'Default company'),
    ('079', 'Default company'),
    ('088', 'Default company'),
    ('092', 'Default company'),
    ('296245', 'Default company'),
    ('325117', 'Default company'),
    ('399849', 'Default company'),
    ('920072', 'Default company'),
    ('458752', 'Default company'),
    ('728219', 'Default company'),
    ('765943', 'Default company'),
    ('946386', 'Default company'),
    ('wellness_unlimited', 'Default company'),
    ('premium_pure', 'Default company')
ON CONFLICT (company_id) DO NOTHING;
