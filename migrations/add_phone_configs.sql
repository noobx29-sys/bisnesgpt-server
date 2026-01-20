-- Migration: Add phone_configs table and alter existing tables for 360dialog support

-- 1. Create phone_configs table
CREATE TABLE IF NOT EXISTS phone_configs (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  phone_index INT NOT NULL,
  connection_type VARCHAR(20) DEFAULT 'wwebjs',

  -- 360dialog specific
  dialog360_client_id VARCHAR(255),
  dialog360_channel_id VARCHAR(255),
  api_key_encrypted TEXT,

  -- Display info
  display_phone_number VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(company_id, phone_index)
);

CREATE INDEX IF NOT EXISTS idx_phone_configs_company ON phone_configs(company_id);
CREATE INDEX IF NOT EXISTS idx_phone_configs_channel ON phone_configs(dialog360_channel_id);

-- 2. Alter phone_status table
ALTER TABLE phone_status
ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) DEFAULT 'wwebjs';

-- 3. Alter messages table
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'wwebjs',
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id);
