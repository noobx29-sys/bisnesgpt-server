# Contact Tagging System - Important Updates

## ✅ Changes Made

### 1. **Groups vs Leads Differentiation**

The system now **only tags individual leads**, not group chats:

- ✅ **Individual leads** (ending with `@c.us`) → **TAGGED**
- ❌ **Group chats** (ending with `@g.us`) → **SKIPPED**

**How it works:**
- Checks if contact_id contains `@g.us`
- Automatically skips groups with message: "⏭️ Skipping group chat"
- Database queries filter out groups automatically

---

### 2. **Additive-Only Tagging (Never Removes Tags)**

Tags are now **permanently additive** - once a tag is added, it stays:

**Before:**
```javascript
Current tags: ['old-tag']
New tags: ['active', 'hot-lead']
Result: ['active', 'hot-lead'] // old-tag REMOVED ❌
```

**After (NEW):**
```javascript
Current tags: ['old-tag']
New tags: ['active', 'hot-lead']
Result: ['old-tag', 'active', 'hot-lead'] // old-tag KEPT ✅
```

**Why?**
- Preserves historical context
- Manual tags won't be removed
- Tags accumulate over time
- You can see the full journey of each contact

---

### 3. **Fixed "new" Tag Logic**

The `new` tag was being applied to everyone. Now fixed:

**New tag is ONLY applied when:**
- `totalMessages = 0` (no messages yet)
- AND `daysSinceFirstContact ≤ 1` (contact created within last day)

**Before:** Everyone got tagged as "new" ❌
**After:** Only truly new contacts with no messages ✅

---

### 4. **JSONB Array Format**

Your database uses **JSONB arrays** for tags, not TEXT[]:

```sql
-- Tags stored as:
tags: ["active", "hot-lead", "query"]

-- NOT as:
tags: {active,hot-lead,query}  -- TEXT[] format
```

All code updated to:
- Stringify arrays when writing: `JSON.stringify(tags)`
- Cast to JSONB: `$1::jsonb`
- Auto-parse when reading (pg driver does this)

---

## 🎯 Usage Examples

### Tag only individual leads (no groups)

```bash
# This will automatically skip all groups
node tagCLI.js tag-all 0210 50
```

**Output:**
```
Processing contact 0210-60123456789@c.us ✅ Tagged
Processing contact 0210-group-123@g.us  ⏭️  Skipped (group)
Processing contact 0210-60987654321@c.us ✅ Tagged
```

### Check what tags are being added (not removed)

```bash
node tagCLI.js test 0210 0210-60123456789@c.us --verbose
```

**Output:**
```
Current Tags: ['manual-tag', 'vip']
Recommended Tags: ['manual-tag', 'vip', 'active', 'hot-lead']
To Add: ['active', 'hot-lead']
To Remove: [] ← Never removes!
```

---

## 📊 Tag Behavior

| Tag | Applied When | Never Applied To |
|-----|--------------|------------------|
| `new` | 0 messages + created today | Existing contacts with messages |
| `active` | Messages in last 3 days | Groups (@g.us) |
| `hot-lead` | Fast responses | Groups (@g.us) |
| `dormant` | No activity 30+ days | Groups (@g.us) |
| `followup-active` | Has scheduled template | Groups (@g.us) |

**All tags:** Only applied to `@c.us` contacts (individual leads)

---

## 🗂️ Database Changes

Run this SQL to create the tables:

```bash
# Copy and paste create_tag_tables.sql into your SQL editor
# OR if you have psql:
psql $DATABASE_URL -f create_tag_tables.sql
```

**Tables created:**
1. `contact_tag_history` - Audit trail of all tag changes
2. `contact_tag_analytics` - Pre-computed stats
3. `tag_definitions` - Tag configurations (23 default tags)

---

## 🚀 Ready to Use

```bash
# 1. Create the tables
# Run create_tag_tables.sql in your SQL editor

# 2. Test with one contact
node tagCLI.js test 0210 YOUR_CONTACT_ID --verbose

# 3. Tag all your leads (not groups!)
node tagCLI.js tag-all 0210 100

# 4. View statistics
node tagCLI.js stats 0210
```

---

## 💡 Key Points

1. ✅ **Groups are SKIPPED** - Only individual @c.us contacts tagged
2. ✅ **Tags are NEVER removed** - Additive only, keeps all history
3. ✅ **"new" tag fixed** - Only for truly new contacts (0 messages)
4. ✅ **JSONB format** - Works with your existing schema
5. ✅ **Follow-up detection** - Automatically detects from scheduled_messages

---

## 🔍 How to Tell Groups from Leads

**In your database:**
```sql
-- Individual leads (WILL BE TAGGED)
contact_id: '0210-60123456789@c.us'
contact_id: '0210-120363366268683798@c.us'

-- Groups (WILL BE SKIPPED)
contact_id: '0210-120363295588953647@g.us'
contact_id: '0210-groupname-12345@g.us'
```

**The system checks:**
- Contains `@g.us` → Group (skip)
- Contains `@c.us` → Lead (tag)

---

## 📝 Manual Tag Management

If you need to remove tags manually:

```javascript
// Via API
PUT /api/tags/contact/:contactId
{
  "companyId": "0210",
  "tags": ["tag-to-keep"],
  "action": "set" // Overwrites all tags
}
```

Or in database:
```sql
UPDATE contacts
SET tags = '["active", "vip"]'::jsonb
WHERE contact_id = '0210-60123456789@c.us';
```

---

**All set! Run the SQL and start tagging your leads (not groups)!** 🎉
