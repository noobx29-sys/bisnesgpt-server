-- Migration: Add active hours support to scheduled_messages table
-- Date: 2025-01-08
-- Description: Adds active_hours_start and active_hours_end columns to support time-restricted message sending

-- Add columns for active hours
ALTER TABLE scheduled_messages 
ADD COLUMN IF NOT EXISTS active_hours_start VARCHAR(5) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS active_hours_end VARCHAR(5) DEFAULT NULL;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_active_hours 
ON scheduled_messages(active_hours_start, active_hours_end);

CREATE INDEX IF NOT EXISTS idx_status_scheduled_time 
ON scheduled_messages(status, scheduled_time);

-- Add comments for documentation
COMMENT ON COLUMN scheduled_messages.active_hours_start IS 'Start time in HH:MM format (24-hour) for when messages can be sent. NULL means no restriction.';
COMMENT ON COLUMN scheduled_messages.active_hours_end IS 'End time in HH:MM format (24-hour) for when messages can be sent. NULL means no restriction.';
