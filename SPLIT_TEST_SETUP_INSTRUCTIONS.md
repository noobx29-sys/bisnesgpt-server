# Split Test System Setup Instructions

## 🚀 Integration Steps

### 1. Database Migration
Run the SQL migration script to create the required tables:

```bash
# Connect to your PostgreSQL database and run:
psql $DATABASE_URL -f split_test_migration.sql
```

### 2. Server.js Integration
Add the split test routes to your `server.js` file. Find the section where routes are registered (around line 732) and add:

```javascript
// Add this import at the top with other route imports (around line 76)
const splitTestRouter = require('./routes/splitTest');

// Add this route registration with other API routes (around line 738)
app.use('/api/split-test', splitTestRouter);
```

### 3. Usage in Your Application

#### For Customer Assignment (when a chat starts):
```javascript
const { assignCustomerToVariation } = require('./utils/splitTestUtils');

// When a customer starts a chat
const assignedVariation = await assignCustomerToVariation(customerId, companyId);

if (assignedVariation) {
  // Use assignedVariation.instructions for AI prompt
  console.log('Using variation instructions:', assignedVariation.instructions);
} else {
  // Use default AI instructions
  console.log('No active variations, using default instructions');
}
```

#### For Marking Customers as Closed:
```javascript
const { markCustomerAsClosed } = require('./utils/splitTestUtils');

// When a customer converts/closes
const success = await markCustomerAsClosed(customerId, companyId);
if (success) {
  console.log('Customer marked as closed for split test tracking');
}
```

## 📊 API Endpoints

The following endpoints are now available:

- `GET /api/split-test/variations?companyId={id}` - Get all variations
- `POST /api/split-test/variations` - Save variations
- `PATCH /api/split-test/variations/{id}/toggle` - Toggle variation status
- `GET /api/split-test/performance?companyId={id}` - Get performance metrics
- `POST /api/split-test/assign-customer` - Assign customer to variation
- `POST /api/split-test/mark-closed` - Mark customer as closed
- `DELETE /api/split-test/variations/{id}?companyId={id}` - Delete variation

## 🎯 Testing

1. Create a few test variations via the API
2. Activate some variations
3. Test customer assignment
4. Mark some customers as closed
5. Check performance metrics

## 🔧 Utilities Available

Import split test utilities anywhere in your codebase:

```javascript
const {
  getCustomerVariationInstructions,
  assignCustomerToVariation,
  markCustomerAsClosed,
  getSplitTestPerformance,
  hasActiveVariations
} = require('./utils/splitTestUtils');
```

## ✅ Verification

After setup, you should be able to:
- ✅ Create unlimited AI prompt variations per company
- ✅ Activate/deactivate variations individually  
- ✅ Automatically assign customers to active variations
- ✅ Track conversion metrics and performance
- ✅ View A/B testing dashboard data

The system is now ready for production use! 