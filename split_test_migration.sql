-- Split Test System Migration
-- Created: 2024

-- Create split test variations table
CREATE TABLE IF NOT EXISTS split_test_variations (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    company_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    instructions TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    customers INTEGER DEFAULT 0,
    closed_customers INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create customer assignments table
CREATE TABLE IF NOT EXISTS customer_variation_assignments (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id VARCHAR(255) NOT NULL,
    variation_id VARCHAR(255) NOT NULL,
    company_id VARCHAR(255) NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMP WITH TIME ZONE NULL,
    FOREIGN KEY (variation_id) REFERENCES split_test_variations(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_split_test_variations_company_id ON split_test_variations(company_id);
CREATE INDEX IF NOT EXISTS idx_split_test_variations_active ON split_test_variations(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customer_assignments_customer_company ON customer_variation_assignments(customer_id, company_id);
CREATE INDEX IF NOT EXISTS idx_customer_assignments_variation ON customer_variation_assignments(variation_id);
CREATE INDEX IF NOT EXISTS idx_customer_assignments_closed ON customer_variation_assignments(is_closed);

-- Create trigger to update updated_at column for variations
CREATE OR REPLACE FUNCTION update_split_test_variations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_split_test_variations_updated_at
    BEFORE UPDATE ON split_test_variations
    FOR EACH ROW
    EXECUTE FUNCTION update_split_test_variations_updated_at();

-- Add unique constraint to prevent duplicate customer assignments within same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_customer_company_assignment 
ON customer_variation_assignments(customer_id, company_id) 
WHERE is_closed = false; 