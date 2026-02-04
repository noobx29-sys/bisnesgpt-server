-- Migration: Add WhatsApp template support to follow-up messages
-- This enables follow-ups to use Meta-approved templates for official API

-- Add WhatsApp template fields to followup_messages table
ALTER TABLE public.followup_messages
ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(10) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS whatsapp_template_variables JSONB DEFAULT '[]';

-- Add comment explaining the fields
COMMENT ON COLUMN public.followup_messages.whatsapp_template_name IS 'Name of the Meta-approved WhatsApp template to use (for official API only)';
COMMENT ON COLUMN public.followup_messages.whatsapp_template_language IS 'Language code for the WhatsApp template (e.g., en, en_US, ms)';
COMMENT ON COLUMN public.followup_messages.whatsapp_template_variables IS 'JSON array of variable values to fill in the template';

-- Create index for faster template lookups
CREATE INDEX IF NOT EXISTS idx_followup_messages_template ON public.followup_messages(whatsapp_template_name) WHERE whatsapp_template_name IS NOT NULL;

-- Add WhatsApp template fields to scheduled_messages table
-- This allows scheduled messages to know which WhatsApp template to use when sending
ALTER TABLE public.scheduled_messages
ADD COLUMN IF NOT EXISTS whatsapp_template_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS whatsapp_template_language VARCHAR(10) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS whatsapp_template_variables JSONB DEFAULT '[]';

-- Add comments
COMMENT ON COLUMN public.scheduled_messages.whatsapp_template_name IS 'Name of the Meta-approved WhatsApp template to use for official API';
COMMENT ON COLUMN public.scheduled_messages.whatsapp_template_language IS 'Language code for the WhatsApp template';
COMMENT ON COLUMN public.scheduled_messages.whatsapp_template_variables IS 'JSON array of variable values for template placeholders';

-- Create index for scheduled messages with templates
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_wa_template ON public.scheduled_messages(whatsapp_template_name) WHERE whatsapp_template_name IS NOT NULL;
