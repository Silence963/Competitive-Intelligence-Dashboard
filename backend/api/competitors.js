const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../utils/db');

/**
 * Add a new competitor and insert data into all three tables:
 * 1. COMPA_COMPANIES
 * 2. SMP_FOLLOWERS
 * 3. COMPA_COMPETITORS
 */
router.post('/api/add-competitor', async (req, res) => {
    try {
        const data = req.body;
        
        // Debug: Print request headers and raw data
        console.log('\n=== Request Headers ===');
        console.log(req.headers);
        console.log('\n=== Raw Request Data ===');
        console.log(data);
        
        // Extract data from nested structure
        const companyData = data.company || {};
        const followersData = data.followers || {};
        const competitorData = data.competitor || {};
        
        // Get company ID from followers or competitor data
        const competCompanyId = followersData.COMPET_COMPANY_ID || competitorData.COMPET_COMPANY_ID;
        
        const mappedData = {
            name: (companyData.NAME || '').trim() || (competitorData.NAME || '').trim(),
            competCompanyId: competCompanyId,
            website: companyData.WEBSITE || competitorData.WEBSITE || '',
            facebookUrl: followersData.FB_PAGE_URL || competitorData.FB_URL || '',
            instagramUrl: followersData.INSTA_PAGE_URL || competitorData.INSTA_URL || '',
            linkedinUrl: followersData.LINKEDIN_PAGE_URL || competitorData.LINKEDIN_URL || ''
        };
        
        // Log received data for debugging
        console.log('Received data:', data);
        console.log('Mapped data:', mappedData);
        
        // Validate required fields
        const requiredFields = ['name', 'competCompanyId'];
        const missingFields = requiredFields.filter(field => !mappedData[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`,
                hasCompanyId: !missingFields.includes('competCompanyId'),
                hasCompetitorName: !missingFields.includes('name'),
                // Frontend expects these exact field names
                companyId: mappedData.competCompanyId,
                competitorName: mappedData.name,
                // Debug info
                receivedData: data,
                mappedData: mappedData
            });
        }
        
        let connection;
        
        try {
            connection = await getDbConnection();
            await connection.beginTransaction();
            
            // 1. Insert into COMPA_COMPANIES
            const insertCompanyQuery = `
                INSERT INTO COMPA_COMPANIES 
                (NAME, WEBSITE, INDUSTRY, VENDOR_ID, MAIN_USERID, CREATED_AT, UPDATED_AT)
                VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            `;
            
            const [companyResult] = await connection.execute(insertCompanyQuery, [
                mappedData.name,
                mappedData.website,
                'General',  // Default industry
                0,  // Default vendor_id
                0   // Default main_userid
            ]);
            
            const companyId = companyResult.insertId;
            
            // 2. Insert into SMP_FOLLOWERS
            const insertFollowersQuery = `
                INSERT INTO SMP_FOLLOWERS 
                (COMPANY_ID, COMPET_COMPANY_ID, FB_PAGE_URL, INSTA_PAGE_URL, 
                 LINKEDIN_PAGE_URL, STATUS, UPDATE_DTM, ISNRT_DTM)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            
            await connection.execute(insertFollowersQuery, [
                companyId,
                mappedData.competCompanyId,
                mappedData.facebookUrl,
                mappedData.instagramUrl,
                mappedData.linkedinUrl,
                'ACTIVE'
            ]);
            
            // 3. Insert into COMPA_COMPETITORS
            const insertCompetitorQuery = `
                INSERT INTO COMPA_COMPETITORS 
                (COMPANY_ID, COMPET_COMPANY_ID, NAME, WEBSITE, FB_URL, INSTA_URL, 
                 LINKEDIN_URL, INDUSTRY, VENDOR_ID, CREATED_AT, UPDATED_AT)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            
            const [competitorResult] = await connection.execute(insertCompetitorQuery, [
                companyId,
                mappedData.competCompanyId,
                mappedData.name,
                mappedData.website,
                mappedData.facebookUrl,
                mappedData.instagramUrl,
                mappedData.linkedinUrl,
                'General',  // Default industry
                0   // Default vendor_id
            ]);
            
            const competitorId = competitorResult.insertId;
            
            // Commit the transaction
            await connection.commit();
            
            res.json({
                success: true,
                company_id: companyId,
                competitor_id: competitorId,
                message: 'Competitor added successfully'
            });
            
        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            throw error;
        } finally {
            if (connection) {
                await connection.end();
            }
        }
        
    } catch (error) {
        console.error('Error adding competitor:', error);
        res.status(500).json({
            success: false,
            error: `An error occurred: ${error.message}`
        });
    }
});

// Keep the old endpoint for backward compatibility
router.post('/api/competitors', async (req, res) => {
    return router.handle(req, res);
});

/**
 * Get all competitors for a company
 */
router.get('/api/competitors/:companyId', async (req, res) => {
    let connection;
    
    try {
        const companyId = req.params.companyId;
        
        connection = await getDbConnection();
        
        const query = `
            SELECT 
                cc.COMPANY_ID, 
                cc.NAME, 
                cc.WEBSITE, 
                cc.INDUSTRY,
                sf.FB_PAGE_URL as facebook_url,
                sf.INSTA_PAGE_URL as instagram_url,
                sf.LINKEDIN_PAGE_URL as linkedin_url,
                sf.FB_FOLLOWER_COUNT as facebook_followers,
                sf.INSTA_FOLLOWER_COUNT as instagram_followers,
                sf.LINKEDIN_FOLLOWER_COUNT as linkedin_followers,
                cc.CREATED_AT
            FROM COMPA_COMPETITORS cc
            JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
            WHERE cc.COMPET_COMPANY_ID = ?
            ORDER BY cc.NAME
        `;
        
        const [competitors] = await connection.execute(query, [companyId]);
        
        res.json({
            success: true,
            data: competitors
        });
        
    } catch (error) {
        console.error('Error fetching competitors:', error);
        res.status(500).json({
            success: false,
            error: `An error occurred: ${error.message}`
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});

module.exports = router;
