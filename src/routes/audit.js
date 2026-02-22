const express = require('express');
const router = express.Router();
const admin = require('../../firebase');

router.post('/run', async (req, res) => {
    try {
        const { companyId } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        const db = admin.firestore();
        const contactsRef = db.collection(`companies/${companyId}/contacts`);
        const snapshot = await contactsRef.get();

        if (snapshot.empty) {
            return res.json({
                pipelineData: { hot: [], warm: [], cold: [], leaked: [] },
                stats: {
                    totalAnalyzed: 0,
                    leakedRevenue: 0,
                    activeOpportunities: 0,
                    warmLeads: 0,
                    hotLeads: 0
                }
            });
        }

        const contacts = [];
        snapshot.forEach(doc => {
            contacts.push({ id: doc.id, ...doc.data() });
        });

        const newPipeline = { hot: [], warm: [], cold: [], leaked: [] };
        let leakedCount = 0;
        const defaultAvgDeal = 2500;

        // This simulates an AI audit doing the heavy lifting
        // In a true AI model, we'd pass these to OpenAI/Anthropic and parse the classification

        const updates = []; // Batch updates for tags

        for (const c of contacts) {
            const randomScore = Math.random();
            let newStage = 'cold';
            let aiTags = [...(c.tags || [])];

            if ((c.unreadCount && c.unreadCount > 2) || randomScore < 0.2) {
                newStage = 'leaked';
                if (!aiTags.includes('leaked')) aiTags.push('leaked');
                leakedCount++;
                newPipeline.leaked.push({ ...c, tags: aiTags });
            } else if (randomScore > 0.8) {
                newStage = 'hot';
                if (!aiTags.includes('hot')) aiTags.push('hot');
                newPipeline.hot.push({ ...c, tags: aiTags });
            } else if (randomScore > 0.5) {
                newStage = 'warm';
                if (!aiTags.includes('warm')) aiTags.push('warm');
                newPipeline.warm.push({ ...c, tags: aiTags });
            } else {
                newPipeline.cold.push({ ...c, tags: aiTags });
            }

            // Prepare update if tags changed (optional: currently disabled to avoid spamming real DB)
            // updates.push(contactsRef.doc(c.id).update({ tags: aiTags }).catch(e => console.error("Update failed", e)));
        }

        // await Promise.all(updates); // Disabled until actually desired

        const stats = {
            totalAnalyzed: contacts.length,
            leakedRevenue: leakedCount * defaultAvgDeal,
            activeOpportunities: newPipeline.hot.length + newPipeline.warm.length,
            warmLeads: newPipeline.warm.length,
            hotLeads: newPipeline.hot.length
        };

        res.json({
            pipelineData: newPipeline,
            stats
        });

    } catch (error) {
        console.error('Error running AI audit:', error);
        res.status(500).json({ error: 'Internal server error while running audit' });
    }
});

module.exports = router;
