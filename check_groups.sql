-- Check how groups vs leads are stored
SELECT 
    contact_id,
    phone,
    name,
    CASE 
        WHEN phone LIKE '%@g.us' THEN 'GROUP'
        WHEN phone LIKE '%@c.us' THEN 'LEAD'
        ELSE 'UNKNOWN'
    END as type
FROM contacts
WHERE company_id = '0210'
LIMIT 20;
