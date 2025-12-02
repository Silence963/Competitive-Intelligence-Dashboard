const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * @route GET /api/social-media/:companyId
 * @description Get social media data for a company
 * @access Public
 */
router.get('/:companyId', async (req, res) => {
  const { companyId } = req.params;
  
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'Company ID is required' });
  }

  try {
    const rows = await db.query(
      `SELECT 
        sf.FB_FOLLOWER_COUNT as facebook_followers,
        sf.INSTA_FOLLOWER_COUNT as instagram_followers,
        sf.LINKEDIN_FOLLOWER_COUNT as linkedin_followers,
        sf.FB_URL as facebook_url,
        sf.INSTA_URL as instagram_url,
        sf.LINKEDIN_URL as linkedin_url,
        sf.ISNRT_DTM as last_updated,
        c.NAME as company_name
      FROM SMP_FOLLOWERS sf
      JOIN COMPA_COMPANIES c ON sf.COMPANY_ID = c.COMPANY_ID
      WHERE sf.COMPANY_ID = ?
      ORDER BY sf.ISNRT_DTM DESC
      LIMIT 1`,
      [companyId]
    );

    if (rows.length === 0) {
      // If no social media data found, return default values
      const company = await db.queryOne(
        'SELECT NAME FROM COMPA_COMPANIES WHERE COMPANY_ID = ?',
        [companyId]
      );
      
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }
      
      return res.json({
        success: true,
        data: {
          company_name: company.NAME,
          facebook_followers: 0,
          instagram_followers: 0,
          linkedin_followers: 0,
          facebook_url: '',
          instagram_url: '',
          linkedin_url: '',
          last_updated: null,
          status: 'no_data'
        }
      });
    }

    // Format the response
    const socialData = {
      ...rows[0],
      status: 'success'
    };

    res.json({ success: true, data: socialData });
  } catch (error) {
    console.error('Error fetching social media data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch social media data' });
  }
});

/**
 * @route POST /api/social-media/update/:companyId
 * @description Trigger an update of social media data for a company
 * @access Public
 */
router.post('/update/:companyId', async (req, res) => {
  const { companyId } = req.params;
  
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'Company ID is required' });
  }

  try {
    // Check if company exists
    const company = await db.queryOne(
      'SELECT COMPANY_ID FROM COMPA_COMPANIES WHERE COMPANY_ID = ?',
      [companyId]
    );
    
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    // Note: Social media scraper functionality has been removed
    
    res.json({ 
      success: true, 
      message: 'Social media data endpoint (scraper functionality removed)',
      data: {
        company_id: companyId,
        status: 'scraper_removed',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error triggering social media update:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger social media update' });
  }
});

module.exports = router;
