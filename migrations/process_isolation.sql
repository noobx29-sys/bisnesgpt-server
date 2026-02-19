-- Migration: Process Isolation for WWebJS and Meta Direct
-- This migration adds columns to track which process handles each bot
-- and creates tables for process health monitoring

-- ============================================
-- 1. Add process_name columns to existing tables
-- ============================================

-- Add process_name to phone_configs
ALTER TABLE phone_configs 
ADD COLUMN IF NOT EXISTS process_name VARCHAR(20) DEFAULT NULL;

-- Add process_name to phone_status
ALTER TABLE phone_status 
ADD COLUMN IF NOT EXISTS process_name VARCHAR(20) DEFAULT NULL;

-- ============================================
-- 2. Set process_name based on connection_type
-- ============================================

-- Set process name for existing records
-- wwebjs connections should be handled by wwebjs process
UPDATE phone_configs 
SET process_name = 'wwebjs' 
WHERE connection_type = 'wwebjs' OR connection_type IS NULL;

-- meta_direct, meta_embedded, and 360dialog should be handled by meta process
UPDATE phone_configs 
SET process_name = 'meta' 
WHERE connection_type IN ('meta_direct', 'meta_embedded', '360dialog');

-- Update phone_status to match phone_configs
UPDATE phone_status ps
SET process_name = pc.process_name
FROM phone_configs pc
WHERE ps.company_id = pc.company_id 
  AND ps.phone_index = pc.phone_index::text;

-- ============================================
-- 3. Create indexes for efficient queries
-- ============================================

-- Index for querying by process name
CREATE INDEX IF NOT EXISTS idx_phone_configs_process 
ON phone_configs(process_name, status) 
WHERE process_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phone_status_process 
ON phone_status(process_name, status) 
WHERE process_name IS NOT NULL;

-- Index for connection type queries
CREATE INDEX IF NOT EXISTS idx_phone_configs_connection_type 
ON phone_configs(connection_type, company_id);

-- ============================================
-- 4. Create process health monitoring table
-- ============================================

CREATE TABLE IF NOT EXISTS process_health (
  process_name VARCHAR(20) PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'unknown',
  last_heartbeat TIMESTAMP DEFAULT NOW(),
  error_count INTEGER DEFAULT 0,
  last_error TEXT DEFAULT NULL,
  uptime_seconds INTEGER DEFAULT 0,
  memory_usage_mb INTEGER DEFAULT 0,
  cpu_usage_percent DECIMAL(5,2) DEFAULT 0.0,
  active_connections INTEGER DEFAULT 0,
  messages_processed INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for health monitoring queries
CREATE INDEX IF NOT EXISTS idx_process_health_status 
ON process_health(status, last_heartbeat);

-- ============================================
-- 5. Create process metrics table
-- ============================================

CREATE TABLE IF NOT EXISTS process_metrics (
  id SERIAL PRIMARY KEY,
  process_name VARCHAR(20) NOT NULL,
  metric_name VARCHAR(50) NOT NULL,
  metric_value DECIMAL(10,2) NOT NULL,
  metric_type VARCHAR(20) NOT NULL, -- 'counter', 'gauge', 'histogram'
  timestamp TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for metrics queries
CREATE INDEX IF NOT EXISTS idx_process_metrics_name_time 
ON process_metrics(process_name, metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_process_metrics_timestamp 
ON process_metrics(timestamp DESC);

-- ============================================
-- 6. Create process events table
-- ============================================

CREATE TABLE IF NOT EXISTS process_events (
  id SERIAL PRIMARY KEY,
  process_name VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  severity VARCHAR(20) DEFAULT 'info', -- 'info', 'warning', 'error', 'critical'
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Index for event queries
CREATE INDEX IF NOT EXISTS idx_process_events_name_time 
ON process_events(process_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_process_events_severity 
ON process_events(severity, timestamp DESC) 
WHERE severity IN ('error', 'critical');

-- ============================================
-- 7. Create function to update process_name automatically
-- ============================================

CREATE OR REPLACE FUNCTION update_process_name_on_connection_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Set process_name based on connection_type
  IF NEW.connection_type = 'wwebjs' OR NEW.connection_type IS NULL THEN
    NEW.process_name := 'wwebjs';
  ELSIF NEW.connection_type IN ('meta_direct', 'meta_embedded', '360dialog') THEN
    NEW.process_name := 'meta';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set process_name
DROP TRIGGER IF EXISTS trigger_set_process_name ON phone_configs;
CREATE TRIGGER trigger_set_process_name
  BEFORE INSERT OR UPDATE OF connection_type ON phone_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_process_name_on_connection_type();

-- ============================================
-- 8. Create function to log process events
-- ============================================

CREATE OR REPLACE FUNCTION log_process_event(
  p_process_name VARCHAR(20),
  p_event_type VARCHAR(50),
  p_event_data JSONB DEFAULT '{}'::jsonb,
  p_severity VARCHAR(20) DEFAULT 'info'
)
RETURNS INTEGER AS $$
DECLARE
  event_id INTEGER;
BEGIN
  INSERT INTO process_events (process_name, event_type, event_data, severity)
  VALUES (p_process_name, p_event_type, p_event_data, p_severity)
  RETURNING id INTO event_id;
  
  RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. Create function to record process metrics
-- ============================================

CREATE OR REPLACE FUNCTION record_process_metric(
  p_process_name VARCHAR(20),
  p_metric_name VARCHAR(50),
  p_metric_value DECIMAL(10,2),
  p_metric_type VARCHAR(20) DEFAULT 'gauge',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER AS $$
DECLARE
  metric_id INTEGER;
BEGIN
  INSERT INTO process_metrics (process_name, metric_name, metric_value, metric_type, metadata)
  VALUES (p_process_name, p_metric_name, p_metric_value, p_metric_type, p_metadata)
  RETURNING id INTO metric_id;
  
  RETURN metric_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. Create function to update process health
-- ============================================

CREATE OR REPLACE FUNCTION update_process_health(
  p_process_name VARCHAR(20),
  p_status VARCHAR(20) DEFAULT 'healthy',
  p_uptime_seconds INTEGER DEFAULT 0,
  p_memory_usage_mb INTEGER DEFAULT 0,
  p_cpu_usage_percent DECIMAL(5,2) DEFAULT 0.0,
  p_active_connections INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO process_health (
    process_name, 
    status, 
    last_heartbeat, 
    uptime_seconds, 
    memory_usage_mb,
    cpu_usage_percent,
    active_connections,
    updated_at
  )
  VALUES (
    p_process_name, 
    p_status, 
    NOW(), 
    p_uptime_seconds, 
    p_memory_usage_mb,
    p_cpu_usage_percent,
    p_active_connections,
    NOW()
  )
  ON CONFLICT (process_name) 
  DO UPDATE SET
    status = EXCLUDED.status,
    last_heartbeat = EXCLUDED.last_heartbeat,
    uptime_seconds = EXCLUDED.uptime_seconds,
    memory_usage_mb = EXCLUDED.memory_usage_mb,
    cpu_usage_percent = EXCLUDED.cpu_usage_percent,
    active_connections = EXCLUDED.active_connections,
    updated_at = EXCLUDED.updated_at,
    error_count = CASE 
      WHEN EXCLUDED.status = 'error' THEN process_health.error_count + 1
      WHEN EXCLUDED.status = 'healthy' THEN 0
      ELSE process_health.error_count
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 11. Create view for process health overview
-- ============================================

CREATE OR REPLACE VIEW v_process_health_overview AS
SELECT 
  ph.process_name,
  ph.status,
  ph.last_heartbeat,
  ph.uptime_seconds,
  ph.memory_usage_mb,
  ph.cpu_usage_percent,
  ph.active_connections,
  ph.messages_processed,
  ph.error_count,
  CASE 
    WHEN ph.last_heartbeat > NOW() - INTERVAL '30 seconds' THEN 'healthy'
    WHEN ph.last_heartbeat > NOW() - INTERVAL '60 seconds' THEN 'degraded'
    ELSE 'down'
  END as computed_status,
  EXTRACT(EPOCH FROM (NOW() - ph.last_heartbeat)) as seconds_since_heartbeat,
  -- Count active bots per process
  COUNT(DISTINCT pc.company_id) as active_bots
FROM process_health ph
LEFT JOIN phone_configs pc ON pc.process_name = ph.process_name
GROUP BY ph.process_name, ph.status, ph.last_heartbeat, ph.uptime_seconds, 
         ph.memory_usage_mb, ph.cpu_usage_percent, ph.active_connections,
         ph.messages_processed, ph.error_count;

-- ============================================
-- 12. Insert initial process health records
-- ============================================

INSERT INTO process_health (process_name, status, last_heartbeat)
VALUES 
  ('api', 'unknown', NOW()),
  ('wwebjs', 'unknown', NOW()),
  ('meta', 'unknown', NOW())
ON CONFLICT (process_name) DO NOTHING;

-- ============================================
-- 13. Create cleanup job for old metrics
-- ============================================

-- Function to clean old metrics (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_process_metrics()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM process_metrics
  WHERE timestamp < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean old events (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_process_events()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM process_events
  WHERE timestamp < NOW() - INTERVAL '30 days'
    AND severity NOT IN ('error', 'critical');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Migration Complete
-- ============================================

-- Log migration completion
SELECT log_process_event(
  'migration',
  'process_isolation_migration_complete',
  '{"version": "1.0", "tables_created": 3, "functions_created": 6}'::jsonb,
  'info'
);

-- Display summary
SELECT 
  'Process Isolation Migration Complete' as status,
  COUNT(*) FILTER (WHERE process_name = 'wwebjs') as wwebjs_bots,
  COUNT(*) FILTER (WHERE process_name = 'meta') as meta_bots,
  COUNT(*) FILTER (WHERE process_name IS NULL) as unassigned_bots
FROM phone_configs;
