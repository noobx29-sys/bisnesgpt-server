-- ==============================================
-- Add phone_count constraints and defaults
-- ==============================================

-- Add phone_count column if it doesn't exist with proper constraints
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone_count INTEGER DEFAULT 1;

-- Add constraints to ensure phone_count is always valid
ALTER TABLE companies ADD CONSTRAINT IF NOT EXISTS phone_count_minimum 
    CHECK (phone_count >= 1);

ALTER TABLE companies ADD CONSTRAINT IF NOT EXISTS phone_count_maximum 
    CHECK (phone_count <= 20);

-- Update any NULL values to default of 1
UPDATE companies SET phone_count = 1 WHERE phone_count IS NULL;

-- Make phone_count NOT NULL
ALTER TABLE companies ALTER COLUMN phone_count SET NOT NULL;

-- Create index for better performance on phone_count queries
CREATE INDEX IF NOT EXISTS idx_companies_phone_count ON companies(phone_count);

-- Create index for plan-based queries (useful for phone limits)
CREATE INDEX IF NOT EXISTS idx_companies_plan ON companies(plan);

COMMIT;