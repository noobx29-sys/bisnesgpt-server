-- Migration: Create phone_configs table for 360dialog integration
-- Run this migration to enable WhatsApp Official API support

-- Create phone_configs table
CREATE TABLE IF NOT EXISTS phone_configs (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255) NOT NULL,
  phone_index INT NOT NULL DEFAULT 0,
  connection_type VARCHAR(20) DEFAULT 'wwebjs',

  -- 360dialog specific fields
  dialog360_client_id VARCHAR(255),
  dialog360_channel_id VARCHAR(255),
  api_key_encrypted TEXT,

  -- Display info
  display_phone_number VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  UNIQUE(company_id, phone_index)
);

-- Create index for faster webhook lookups
CREATE INDEX IF NOT EXISTS idx_phone_configs_channel ON phone_configs(dialog360_channel_id);
CREATE INDEX IF NOT EXISTS idx_phone_configs_company ON phone_configs(company_id);

-- Alter phone_status table to add connection_type
ALTER TABLE phone_status
ADD COLUMN IF NOT EXISTS connection_type VARCHAR(20) DEFAULT 'wwebjs';

-- Alter messages table to track provider and external ID
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'wwebjs',
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

-- Create index for external_id lookups (for status updates)
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL;

-- Add comment to table
COMMENT ON TABLE phone_configs IS 'Stores phone configuration for both wwebjs and 360dialog connections';
COMMENT ON COLUMN phone_configs.connection_type IS 'Either wwebjs (QR code) or official (360dialog)';
COMMENT ON COLUMN phone_configs.api_key_encrypted IS 'AES-256-GCM encrypted API key for 360dialog';
