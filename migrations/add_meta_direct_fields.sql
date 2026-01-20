-- Migration: Add Meta Direct WhatsApp fields to phone_configs
-- Date: 2026-01-19
-- Description: Adds fields to support direct Meta WhatsApp Business Cloud API integration

-- Add new columns for Meta Direct connection
ALTER TABLE phone_configs
  ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS meta_access_token_encrypted TEXT;

-- Create index on phone_number_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_phone_configs_meta_phone_number_id
  ON phone_configs(meta_phone_number_id);

-- Add comment to document the new connection type
COMMENT ON COLUMN phone_configs.meta_phone_number_id IS 'Meta WhatsApp Business Phone Number ID';
COMMENT ON COLUMN phone_configs.meta_waba_id IS 'Meta WhatsApp Business Account ID (WABA ID)';
COMMENT ON COLUMN phone_configs.meta_access_token_encrypted IS 'Encrypted permanent access token for Meta Graph API (AES-256-GCM)';
