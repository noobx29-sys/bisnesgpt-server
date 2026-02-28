-- Firaz AI Sales Employee tables
-- Leads pipeline + conversation tracking

CREATE TABLE IF NOT EXISTS firaz_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(500),
  address TEXT,
  city VARCHAR(255),
  source VARCHAR(50) DEFAULT 'google_maps',
  stage VARCHAR(50) DEFAULT 'new',
  score INTEGER DEFAULT 0,
  has_facebook_ads BOOLEAN,
  ad_count INTEGER,
  research_data JSONB DEFAULT '{}',
  qualification_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firaz_leads_company ON firaz_leads(company_id);
CREATE INDEX IF NOT EXISTS idx_firaz_leads_stage ON firaz_leads(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_firaz_leads_score ON firaz_leads(company_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_firaz_leads_phone ON firaz_leads(phone, company_id);

CREATE TABLE IF NOT EXISTS firaz_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES firaz_leads(id) ON DELETE CASCADE,
  company_id VARCHAR(255) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  channel VARCHAR(50) DEFAULT 'whatsapp',
  message TEXT NOT NULL,
  sent_by VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firaz_conversations_lead ON firaz_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_firaz_conversations_company ON firaz_conversations(company_id);
