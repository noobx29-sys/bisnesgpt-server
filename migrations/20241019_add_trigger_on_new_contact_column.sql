-- Add trigger_on_new_contact column to followup_templates table
ALTER TABLE public.followup_templates 
ADD COLUMN IF NOT EXISTS trigger_on_new_contact BOOLEAN NOT NULL DEFAULT false;

-- Add an index for better performance when querying by this flag
CREATE INDEX IF NOT EXISTS idx_followup_templates_trigger_new_contact 
ON public.followup_templates(company_id, trigger_on_new_contact) 
WHERE status = 'active' AND trigger_on_new_contact = true;
