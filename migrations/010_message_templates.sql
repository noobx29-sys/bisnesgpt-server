-- Migration: Create message_templates table and track 24-hour window
-- This enables WhatsApp Business API template management and 24-hour session tracking

-- Create message_templates table to store synced Meta templates
CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  phone_index INT NOT NULL DEFAULT 0,
  
  -- Meta template identifiers
  template_id VARCHAR(255) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  template_language VARCHAR(10) NOT NULL DEFAULT 'en',
  
  -- Template content
  category VARCHAR(50), -- MARKETING, UTILITY, AUTHENTICATION
  status VARCHAR(50), -- APPROVED, PENDING, REJECTED
  
  -- Components stored as JSON
  components JSONB,
  
  -- Example content for preview
  example_content JSONB,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  synced_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(company_id, phone_index, template_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_message_templates_company ON message_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_status ON message_templates(status);
CREATE INDEX IF NOT EXISTS idx_message_templates_name ON message_templates(template_name);

-- Create conversation_sessions table to track 24-hour messaging windows
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  phone_index INT NOT NULL DEFAULT 0,
  contact_phone VARCHAR(50) NOT NULL, -- The customer's phone number
  
  -- Session tracking
  last_customer_message_at TIMESTAMP, -- Last time customer messaged us
  last_business_message_at TIMESTAMP, -- Last time we messaged customer
  session_open BOOLEAN DEFAULT false, -- Is the 24-hour window currently open?
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(company_id, phone_index, contact_phone)
);

-- Create indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_company ON conversation_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_phone ON conversation_sessions(contact_phone);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_last_msg ON conversation_sessions(last_customer_message_at);

-- Add comments
COMMENT ON TABLE message_templates IS 'Stores WhatsApp Business API message templates synced from Meta';
COMMENT ON COLUMN message_templates.category IS 'Template category: MARKETING, UTILITY, or AUTHENTICATION';
COMMENT ON COLUMN message_templates.status IS 'Meta approval status: APPROVED, PENDING, REJECTED';
COMMENT ON COLUMN message_templates.components IS 'Template structure with header, body, footer, buttons as JSON';

COMMENT ON TABLE conversation_sessions IS 'Tracks 24-hour messaging window with customers for Official API';
COMMENT ON COLUMN conversation_sessions.last_customer_message_at IS 'Last incoming message from customer - determines 24h window';
COMMENT ON COLUMN conversation_sessions.session_open IS 'True if within 24h of last customer message';

-- Create function to check if session is open (within 24 hours)
CREATE OR REPLACE FUNCTION is_session_open(last_msg TIMESTAMP)
RETURNS BOOLEAN AS $$
BEGIN
  IF last_msg IS NULL THEN
    RETURN false;
  END IF;
  RETURN (NOW() - last_msg) < INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Create function to update session when customer messages
CREATE OR REPLACE FUNCTION update_customer_session()
RETURNS TRIGGER AS $$
BEGIN
  -- Update session when a new incoming message arrives
  INSERT INTO conversation_sessions (
    company_id, phone_index, contact_phone, 
    last_customer_message_at, session_open, updated_at
  )
  VALUES (
    NEW.company_id, 
    COALESCE(NEW.phone_index, 0), 
    NEW.contact_phone,
    NOW(), 
    true, 
    NOW()
  )
  ON CONFLICT (company_id, phone_index, contact_phone) DO UPDATE SET
    last_customer_message_at = NOW(),
    session_open = true,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
