-- Create message_usage table for tracking message usage per company per month
CREATE TABLE IF NOT EXISTS public.message_usage (
    id uuid DEFAULT public.uuid_generate_v4() PRIMARY KEY,
    company_id character varying(255) NOT NULL,
    month character varying(7) NOT NULL, -- Format: YYYY-MM
    total_messages integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, month)
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_message_usage_company_month ON public.message_usage USING btree (company_id, month);

-- Add trigger to update updated_at column
CREATE TRIGGER update_message_usage_updated_at 
    BEFORE UPDATE ON public.message_usage 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

-- Insert some sample data for existing companies (optional)
-- You can run this if you want to initialize with some data
-- INSERT INTO public.message_usage (company_id, month, total_messages) 
-- VALUES 
--     ('0123', '2024-01', 0),
--     ('0380', '2024-01', 0)
-- ON CONFLICT (company_id, month) DO NOTHING; 