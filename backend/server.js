
/**
 * COMPA BUSINESS INTELLIGENCE SERVER
 * 
 * SECURITY & ARCHITECTURE IMPROVEMENTS APPLIED:
 * 
 * 1. RACE CONDITION ELIMINATED:
 *    - Added database transactions in /api/add-competitor
 *    - Uses FOR UPDATE locks to prevent concurrent modifications
 *    - Ensures atomic operations for competitor creation/linking
 * 
 * 2. CODE REDUNDANCY REDUCED:
 *    - Individual report endpoints marked as DEPRECATED
 *    - All reports should use unified /api/generate-report/:reportType
 *    - Reduces maintenance overhead and improves consistency
 * 
 * 3. ENHANCED FEATURES:
 *    - Date-aware AI prompts with current context
 *    - Professional consultant credentials in all prompts
 *    - Robust input validation and error handling
 *    - Comprehensive transaction management
 * 
 * 4. LOCATION-BASED COMPETITIVE ANALYSIS:
 *    - All reports now include company location (REGION) from kf_vendor table
 *    - Company names displayed with location: "CompanyName (City, State, Country)"
 *    - All competitive analysis scoped to regional market dynamics
 *    - Recommendations tailored to local market conditions and regional competition
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const FollowerScrapingService = require('./FollowerScrapingService');
const GoogleReviewsService = require('./services/GoogleReviewsService');

// Utility function for consistent date context in all prompts
function getCurrentDateContext() {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  return {
    currentDate,
    dateNote: `**Current Date:** ${currentDate}\n**Important:** All recommendations, timelines, and strategic plans must be realistic and consider current market conditions as of this date.`
  };
}

const db = require('./db');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Initialize Follower Scraping Service
const followerService = new FollowerScrapingService();

const app = express();
const port = 5600; // Set fixed port for backend

app.use(cors());
app.use(express.json());

// Multi-tenant context middleware: capture user/firm IDs from query string
app.use((req, res, next) => {
  if (req.query) {
    if (req.query.userid) req.userId = req.query.userid;
    if (req.query.firmid) req.firmId = req.query.firmid;
  }
  // Fallback: accept JSON body values for POSTs if query absent
  if ((!req.userId || !req.firmId) && req.body && typeof req.body === 'object') {
    if (!req.userId && req.body.userid) req.userId = req.body.userid;
    if (!req.firmId && req.body.firmid) req.firmId = req.body.firmid;
  }
  next();
});

// Enforce tenant context for /api routes
function requireTenant(req, res, next){
  if(req.path.startsWith('/api')){
    // Public, non-tenant specific endpoints (no user scoping required)
    const publicEndpoints = (
      (req.method === 'GET' && (
        req.path.startsWith('/api/load-preferences/') ||
        req.path.startsWith('/api/view-competitors/')
      )) ||
      (req.method === 'POST' && (
        req.path === '/api/register-company' ||
        req.path === '/api/add-competitor'
      ))
    );
    if(!publicEndpoints){
      if(!req.userId || !req.firmId){
        return res.status(400).json({ success:false, error:'Missing userid & firmid (query ?userid=...&firmid=... or JSON body)' });
      }
    }
  }
  next();
}
app.use(requireTenant);

// Normalize incoming provider type values to DB ENUM values: 'TEXT-TO-TEXT' | 'TEXT-TO-IMAGE'
const TYPE_MAP_TO_ENUM = {
  // Direct enum passthrough
  'TEXT-TO-TEXT': 'TEXT-TO-TEXT',
  'TEXT-TO-IMAGE': 'TEXT-TO-IMAGE',
  // UI long names -> enum
  LANGUAGE_TEXT: 'TEXT-TO-TEXT',
  IMAGE_GENERATION: 'TEXT-TO-IMAGE',
  CAPTION_GENERATION: 'TEXT-TO-TEXT', // image -> text output
  MUSIC_GENERATION: 'TEXT-TO-TEXT',   // best-effort mapping
  VOICE_SYNTHESIS: 'TEXT-TO-TEXT',    // best-effort mapping
  VIDEO_GENERATION: 'TEXT-TO-IMAGE',  // best-effort mapping
  // 3-letter and 1-letter shorthand -> enum
  LANG: 'TEXT-TO-TEXT', IMG: 'TEXT-TO-IMAGE', CAP: 'TEXT-TO-TEXT', MUS: 'TEXT-TO-TEXT', TTS: 'TEXT-TO-TEXT', VID: 'TEXT-TO-IMAGE',
  L: 'TEXT-TO-TEXT', I: 'TEXT-TO-IMAGE', C: 'TEXT-TO-TEXT', M: 'TEXT-TO-TEXT', T: 'TEXT-TO-TEXT', V: 'TEXT-TO-IMAGE'
};

function normalizeProviderType(value) {
  if (!value) return null;
  const key = String(value).trim();
  return TYPE_MAP_TO_ENUM[key] || null;
}

// ---------------------------------------------
// LLM API Key Management (per User/Firm)
// ---------------------------------------------

// Helper: fetch active API key for a given user/firm and provider type
async function getActiveApiKey(userid, firmid, providerType = 'TEXT-TO-TEXT') {
  if (!userid || !firmid) return null;
  try {
    const row = await db.queryOne(
      `SELECT API_KEY FROM LLM_DETAILS 
       WHERE USERID = ? AND FIRMID = ? AND LLM_PROVIDER_TYPE = ? AND STATUS = 'ACTIVE' 
       ORDER BY UPD_DTM DESC LIMIT 1`,
      [userid, firmid, providerType]
    );
    return row ? row.API_KEY : null;
  } catch (err) {
    console.error('❌ Error fetching active API key:', err);
    return null;
  }
}

// GET keys by user/firm
app.get('/api/get-llm-details', async (req, res) => {
  const { userid, firmid } = req.query;
  if (!userid || !firmid) return res.status(400).json({ error: 'userid and firmid are required' });
  try {
    const rows = await db.query(
      `SELECT ID, USERID, FIRMID, LLM_PROVIDER_TYPE, LLM_PROVIDER, API_KEY, STATUS,
              INSRT_DTM, UPD_DTM AS UPDATED_AT
       FROM LLM_DETAILS WHERE USERID = ? AND FIRMID = ? ORDER BY UPD_DTM DESC`,
      [userid, firmid]
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching LLM details:', err);
    res.status(500).json({ error: 'Failed to fetch LLM details' });
  }
});

// Add a new API key
app.post('/api/add-api-key', async (req, res) => {
  const { USERID, FIRMID, userid, firmid, LLM_PROVIDER_TYPE, LLM_PROVIDER, API_KEY } = req.body || {};
  console.log('🔎 Received add-api-key payload:', req.body);
  
  // Handle both uppercase and lowercase parameter names
  const USER_ID = USERID || userid;
  const FIRM_ID = FIRMID || firmid;
  
  if (!USER_ID || !FIRM_ID || !LLM_PROVIDER_TYPE || !LLM_PROVIDER || !API_KEY) {
    console.error('❌ Missing required field(s) in add-api-key:', { USERID: USER_ID, FIRMID: FIRM_ID, LLM_PROVIDER_TYPE, LLM_PROVIDER, API_KEY });
    return res.status(400).json({ error: 'USERID, FIRMID, LLM_PROVIDER_TYPE, LLM_PROVIDER, API_KEY are required' });
  }
  try {
    const normalizedType = normalizeProviderType(LLM_PROVIDER_TYPE);
    if (!normalizedType) {
      return res.status(400).json({ error: 'Invalid LLM_PROVIDER_TYPE' });
    }
    
    // Ensure proper string encoding to avoid collation issues
    const cleanUserId = String(USER_ID).trim();
    const cleanFirmId = String(FIRM_ID).trim();
    const cleanProvider = String(LLM_PROVIDER).trim();
    // Convert API key to ASCII-safe format and check length
    const cleanApiKey = Buffer.from(String(API_KEY).trim(), 'utf8').toString('latin1');
    
    // Validate API key length (database column is varchar(500) after migration)
    if (cleanApiKey.length > 500) {
      console.error('❌ API key too long:', cleanApiKey.length, 'characters (max 500)');
      return res.status(400).json({ 
        error: `API key is too long (${cleanApiKey.length} characters). Maximum allowed is 500 characters.`,
        keyLength: cleanApiKey.length,
        maxLength: 500
      });
    }
    
    console.log('➕ Adding API key', { USERID: cleanUserId, FIRMID: cleanFirmId, LLM_PROVIDER_TYPE, normalizedType, LLM_PROVIDER: cleanProvider });
    await db.execute(
      `INSERT INTO LLM_DETAILS (USERID, FIRMID, LLM_PROVIDER_TYPE, LLM_PROVIDER, API_KEY, STATUS, INSRT_DTM, UPD_DTM)
       VALUES (?, ?, ?, ?, ?, 'INACTIVE', NOW(), NOW())`,
      [cleanUserId, cleanFirmId, normalizedType, cleanProvider, cleanApiKey]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error adding API key:', err);
    res.status(500).json({ success: false, error: err?.sqlMessage || err?.message || 'Failed to add API key' });
  }
});

// Toggle status to ACTIVE for one provider (per provider_type), deactivate others
app.post('/api/toggle-status', async (req, res) => {
  const { id, userid, firmid, provider_type, action } = req.body || {};
  if (!id || !userid || !firmid || !provider_type) {
    return res.status(400).json({ success: false, error: 'id, userid, firmid, provider_type are required' });
  }
  
  try {
    const normalizedType = normalizeProviderType(provider_type);
    if (!normalizedType) {
      return res.status(400).json({ success: false, error: 'Invalid provider_type' });
    }

    if ((action || '').toUpperCase() === 'DEACTIVATE') {
      // Deactivate only this record
      await db.execute(
        `UPDATE LLM_DETAILS SET STATUS = 'INACTIVE', UPD_DTM = NOW() WHERE ID = ?`,
        [id]
      );
      return res.json({ success: true, newStatus: 'INACTIVE' });
    }

    // Start a transaction to ensure atomicity
    const connection = await db.pool.getConnection();
    await connection.beginTransaction();

    try {
      // Deactivate all providers of this type for the user/firm
      await connection.execute(
        `UPDATE LLM_DETAILS SET STATUS = 'INACTIVE' 
         WHERE USERID = ? AND FIRMID = ? AND LLM_PROVIDER_TYPE = ?`,
        [userid, firmid, normalizedType]
      );
      
      // Activate the selected provider
      await connection.execute(
        `UPDATE LLM_DETAILS SET STATUS = 'ACTIVE', UPD_DTM = NOW() WHERE ID = ?`,
        [id]
      );
      
      await connection.commit();
      res.json({ success: true, newStatus: 'ACTIVE' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('❌ Error toggling status:', err);
    res.status(500).json({ success: false, error: err?.sqlMessage || err?.message || 'Failed to toggle status' });
  }
});

// Database connection is handled by the pool in db.js
app.use(express.static(path.join(__dirname, "build")));

// Social Media Routes removed - scraper functionality removed

// Endpoint to get all previous action plans for a competitor (for modal)
app.get("/api/get-action-plans", async (req, res) => {
  const { companyId, competitorId, userid, firmid } = req.query;
  if (!companyId || !competitorId || !userid || !firmid) {
    return res.status(400).json({ error: "companyId, competitorId, userid, and firmid are required." });
  }
  try {
    const plans = await db.query(
      `SELECT STEP_ACTION, STATUS, USER_INPUT, CREATED_AT FROM SMB_ACTION_LOGS
       WHERE COMPANY_ID = ? AND COMPETITOR_ID = ? AND STEP_ID = 'action-plan' AND ACTION_TYPE = 'COMPA' AND USERID = ? AND FIRMID = ?
       ORDER BY CREATED_AT DESC`,
      [companyId, competitorId, userid, firmid]
    );
    res.json({ success: true, plans });
  } catch (err) {
    console.error("❌ Error fetching previous action plans:", err);
    res.status(500).json({ success: false, error: "Failed to fetch previous action plans." });
  }
});

// Competitors API
app.get("/competitors", async (req, res) => {
  try {
    const rows = await db.getRows("SELECT COMPANY_ID as id, NAME as name FROM COMPA_COMPANIES");
    res.json(rows);
  } catch (err) {
    console.error('❌ Error fetching competitors:', err);
    res.status(500).json({ error: "Failed to fetch companies." });
  }
});


// Get all competitors for a company
app.get("/api/view-competitors/:companyId", async (req, res) => {
  const { companyId } = req.params;
  try {
    // Get all competitors for this company
    const competitors = await db.query(
      `SELECT 
        cc.COMPANY_ID, 
        cc.NAME, 
        cc.INDUSTRY, 
        cc.WEBSITE, 
        c.FB_URL, 
        c.INSTA_URL, 
        c.LINKEDIN_URL,
        c.CREATED_AT
       FROM COMPA_COMPETITORS c
       JOIN COMPA_COMPANIES cc ON c.COMPET_COMPANY_ID = cc.COMPANY_ID
       WHERE c.COMPANY_ID = ?
       ORDER BY c.CREATED_AT DESC`,
      [companyId]
    );
    
    res.json({ success: true, competitors });
  } catch (err) {
    console.error("❌ Error fetching competitors:", err);
    res.status(500).json({ success: false, error: "Failed to fetch competitors." });
  }
});

/**
 * @route POST /api/add-competitor
 * @description Add a new competitor
 * @param {string} companyId - The ID of the company to add a competitor for
 * @param {string} competitorName - The name of the competitor to add
 * @param {string} [website] - Optional website URL
 * @param {string} [industry] - Optional industry type
 * @param {string} [facebookUrl] - Optional Facebook URL
 * @param {string} [instagramUrl] - Optional Instagram URL
 * @param {string} [linkedinUrl] - Optional LinkedIn URL
 * @returns {Object} Response with success status and data/error message
 */
app.post("/api/add-competitor", async (req, res) => {
  // 1. Input validation
  const { companyId, competitorName, website, industry, region, facebookUrl, instagramUrl, linkedinUrl, googleReviewUrl } = req.body;
  
  // Validate required fields
  if (!companyId || !competitorName) {
    return res.status(400).json({ 
      success: false, 
      error: "Both companyId and competitorName are required.",
      code: "MISSING_REQUIRED_FIELDS"
    });
  }
  
  // Sanitize inputs
  const sanitizedCompetitorName = competitorName.trim();
  const sanitizedCompanyId = String(companyId).trim();
  
  if (sanitizedCompetitorName.length < 2) {
    return res.status(400).json({
      success: false,
      error: "Competitor name must be at least 2 characters long.",
      code: "INVALID_INPUT"
    });
  }

  try {
    // Use transaction to prevent race conditions
    const connection = await db.pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 2. Check if company exists
      const [companyExistsRows] = await connection.query(
        "SELECT COMPANY_ID FROM COMPA_COMPANIES WHERE COMPANY_ID = ?",
        [sanitizedCompanyId]
      );
      const companyExists = companyExistsRows[0];

      if (!companyExists) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: `Company with ID ${sanitizedCompanyId} not found`,
          code: "COMPANY_NOT_FOUND"
        });
      }

      // 3. Check if competitor already exists as a company (within transaction)
      const [competitorRows] = await connection.query(
        "SELECT COMPANY_ID, NAME FROM COMPA_COMPANIES WHERE NAME = ? FOR UPDATE",
        [sanitizedCompetitorName]
      );
      let competitor = competitorRows[0];

      let competitorId;
      let isNewCompany = false;

      if (competitor) {
        competitorId = competitor.COMPANY_ID;
        // Update existing company with any new URL information
        await connection.query(
          `UPDATE COMPA_COMPANIES SET 
            WEBSITE = COALESCE(?, WEBSITE),
            INDUSTRY = COALESCE(?, INDUSTRY),
            UPDATED_AT = NOW()
          WHERE COMPANY_ID = ?`,
          [website || null, industry || null, competitorId]
        );
        
        // Also update kf_vendor if exists
        await connection.query(
          `UPDATE kf_vendor SET 
            VEND_URL = COALESCE(?, VEND_URL),
            VEND_IND_INF = COALESCE(?, VEND_IND_INF),
            INDUSTRY_TYPE = COALESCE(?, INDUSTRY_TYPE),
            FB_PAGE_URL = COALESCE(?, FB_PAGE_URL),
            INSTA_PAGE_URL = COALESCE(?, INSTA_PAGE_URL),
            LINKEDIN_PAGE_URL = COALESCE(?, LINKEDIN_PAGE_URL),
            GOOGLE_RVW_LINK = COALESCE(?, GOOGLE_RVW_LINK),
            UPDATE_DTM = NOW()
          WHERE VEND_ID = ?`,
          [
            website || null,
            industry || null,
            industry || null,
            facebookUrl || null,
            instagramUrl || null,
            linkedinUrl || null,
            googleReviewUrl || null,
            competitorId
          ]
        );
      } else {
        // 4. Create new company - First insert into kf_vendor to get VEND_ID
        const [vendorResult] = await connection.query(
          `INSERT INTO kf_vendor (
            VEND_TITL, VEND_URL, VEND_IND_INF, COMPANY_NAME, INDUSTRY_TYPE,
            CITY, STATE, COUNTRY,
            PORTAL_ID, MEMBERID, VEND_SDATE, INSRT_DTM,
            VEND_CATEGRY, CATEGORY_ID,
            FB_PAGE_URL, INSTA_PAGE_URL, LINKEDIN_PAGE_URL, GOOGLE_RVW_LINK,
            STATUS, UPDATE_DTM
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), NOW(), ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW())`,
          [
            sanitizedCompetitorName,
            website || '',
            industry || '',
            sanitizedCompetitorName,
            industry || '',
            region || '',
            region || '',
            region || '',
            0,
            0,
            industry || '',
            0,
            facebookUrl || null,
            instagramUrl || null,
            linkedinUrl || null,
            googleReviewUrl || null
          ]
        );
        const vendorId = vendorResult.insertId;
        console.log(`✅ Inserted competitor into kf_vendor with VEND_ID: ${vendorId}`);
        
        // 5. Now insert into COMPA_COMPANIES using VEND_ID as COMPANY_ID
        await connection.query(
          `INSERT INTO COMPA_COMPANIES (
            COMPANY_ID,
            NAME, 
            WEBSITE, 
            INDUSTRY, 
            VENDOR_ID, 
            MAIN_USERID, 
            CREATED_AT, 
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, 0, 0, NOW(), NOW())`,
          [vendorId, sanitizedCompetitorName, website || '', industry || '']
        );
        competitorId = vendorId;
        isNewCompany = true;
        console.log(`✅ Inserted competitor into COMPA_COMPANIES with COMPANY_ID: ${vendorId}`);
      }

      // 5. Check if competitor is already linked (within transaction)
      const [existingLinkRows] = await connection.query(
        "SELECT * FROM COMPA_COMPETITORS WHERE COMPANY_ID = ? AND COMPET_COMPANY_ID = ? FOR UPDATE",
        [sanitizedCompanyId, competitorId]
      );
      const existingLink = existingLinkRows[0];

      if (!existingLink) {
        // 6. Link the competitor
        await connection.query(
          `INSERT INTO COMPA_COMPETITORS (
            COMPANY_ID, 
            COMPET_COMPANY_ID, 
            NAME, 
            WEBSITE, 
            FB_URL, 
            INSTA_URL, 
            LINKEDIN_URL,
            GOGL_RVW_URL,
            CREATED_AT, 
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            sanitizedCompanyId,
            competitorId,
            sanitizedCompetitorName,
            website || null,
            facebookUrl || null,
            instagramUrl || null,
            linkedinUrl || null,
            googleReviewUrl || null
          ]
        );
      }

      // Commit transaction
      await connection.commit();
      connection.release();

      // 7. Return success response
      return res.json({
        success: true,
        message: isNewCompany 
          ? "New competitor added successfully" 
          : "Competitor linked successfully",
        companyId: competitorId,
        companyName: sanitizedCompetitorName,
        isNew: isNewCompany
      });
      
    } catch (transactionErr) {
      // Rollback transaction on error
      await connection.rollback();
      connection.release();
      throw transactionErr;
    }
  } catch (err) {
    console.error("❌ Error in /api/add-competitor:", err);
    
    // Return error response
    return res.status(500).json({
      success: false,
      error: err.message || 'An unexpected error occurred while processing the request',
      code: err.code || 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

// Save SWOT preferences for a company
app.post("/api/save-preferences", async (req, res) => {
  const { companyId, name, competitorIds } = req.body;
  let { timeRange } = req.body;
  const prefType = 'COMPA';
  
  // Default to 'weekly' if not provided
  if (!timeRange) {
    timeRange = 'weekly';
  }
  
  if (!companyId || !name) {
    return res.status(400).json({ error: "companyId and name are required." });
  }

  // Validate timeRange against allowed ENUM values
  const validTimeRanges = ['daily', 'weekly', '2-weekly', 'monthly'];
  if (!validTimeRanges.includes(timeRange)) {
    console.error(`❌ Invalid timeRange value: "${timeRange}". Must be one of: ${validTimeRanges.join(', ')}`);
    return res.status(400).json({ 
      success: false, 
      error: `Invalid time range. Must be one of: ${validTimeRanges.join(', ')}` 
    });
  }

  try {
    await db.execute(
      `INSERT INTO AIA_SMP_PREFERENCES (COMPANY_ID, NAME, PREF_TYPE, TIME_RANGE, COMPETITOR_IDS) VALUES (?, ?, ?, ?, ?)`,
      [companyId, name, prefType, timeRange, JSON.stringify(competitorIds || [])]
    );
    res.json({ success: true, message: "Preference saved successfully." });
  } catch (err) {
    console.error("❌ Error saving preference:", err);
    res.status(500).json({ success: false, error: "Failed to save preference." });
  }
});

// Load SWOT preferences for a company
app.get("/api/load-preferences/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const prefType = 'COMPA';
  
  if (!companyId) {
    return res.status(400).json({ 
      success: false,
      error: "companyId is required." 
    });
  }

  try {
    const rows = await db.query(
      `SELECT PREF_ID as prefId, 
              COMPANY_ID as companyId, 
              NAME as name, 
              PREF_TYPE as prefType, 
              TIME_RANGE as timeRange, 
              COMPETITOR_IDS as competitorIds
       FROM AIA_SMP_PREFERENCES 
       WHERE COMPANY_ID = ? AND PREF_TYPE = ?
       ORDER BY PREF_ID DESC`,
      [companyId, prefType]
    );
    
    // Process the rows to ensure consistent data structure
    const preferences = rows.map(row => {
      try {
        // Ensure competitorIds is always an array
        const competitorIds = Array.isArray(row.competitorIds)
          ? row.competitorIds
          : (() => {
              try {
                return JSON.parse(row.competitorIds || '[]');
              } catch (e) {
                console.error('Invalid competitorIds format:', row.competitorIds);
                return [];
              }
            })();
            
        return {
          prefId: row.prefId,
          companyId: row.companyId,
          name: row.name,
          prefType: row.prefType,
          timeRange: row.timeRange,
          competitorIds: Array.isArray(competitorIds) ? competitorIds : []
        };
      } catch (e) {
        console.error('Error processing preference row:', e);
        return {
          prefId: row.prefId,
          companyId: row.companyId,
          name: row.name,
          prefType: row.prefType,
          timeRange: row.timeRange,
          competitorIds: []
        };
      }
    });
    
    res.json({ success: true, preferences: preferences || [] });
  } catch (err) {
    console.error("❌ Error loading preferences:", err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ success: false, error: err.message || "Failed to load preferences." });
  }
});

// Update SWOT preference for a company
app.put("/api/update-preference/:prefId", async (req, res) => {
  const { prefId } = req.params;
  const { companyId, name, competitorIds } = req.body;
  let { timeRange } = req.body;
  const prefType = 'COMPA';

  // Default to 'weekly' if not provided
  if (!timeRange) {
    timeRange = 'weekly';
  }

  if (!prefId || !companyId || !name) {
    return res.status(400).json({ error: "prefId, companyId, and name are required." });
  }

  // Validate timeRange against allowed ENUM values
  const validTimeRanges = ['daily', 'weekly', '2-weekly', 'monthly'];
  if (!validTimeRanges.includes(timeRange)) {
    console.error(`❌ Invalid timeRange value: "${timeRange}". Must be one of: ${validTimeRanges.join(', ')}`);
    return res.status(400).json({ 
      success: false, 
      error: `Invalid time range. Must be one of: ${validTimeRanges.join(', ')}` 
    });
  }

  try {
    await db.execute(
      `UPDATE AIA_SMP_PREFERENCES 
       SET COMPANY_ID = ?, NAME = ?, PREF_TYPE = ?, TIME_RANGE = ?, COMPETITOR_IDS = ? 
       WHERE PREF_ID = ? AND PREF_TYPE = ?`,
      [companyId, name, prefType, timeRange, JSON.stringify(competitorIds || []), prefId, prefType]
    );
    res.json({ success: true, message: "Preference updated successfully." });
  } catch (err) {
    console.error("❌ Error updating preference:", err);
    res.status(500).json({ success: false, error: "Failed to update preference." });
  }
});

// Delete a preference by PREF_ID
app.delete("/api/delete-preference/:prefId", async (req, res) => {
  const { prefId } = req.params;
  const prefType = 'COMPA';
  if (!prefId) return res.status(400).json({ error: "prefId is required." });
  try {
    await db.execute(
      `DELETE FROM AIA_SMP_PREFERENCES WHERE PREF_ID = ? AND PREF_TYPE = ?`,
      [prefId, prefType]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting preference:", err);
    res.status(500).json({ success: false, error: "Failed to delete preference." });
  }
});

app.get("/combined-info", async (req, res) => {
  const companyId = req.query.companyId;
  if (!companyId) return res.status(400).json({ error: "Company ID is required." });

  // Optional filters
  const timeRange = req.query.timeRange || null;
  let competitorIds = [];
  if (req.query.competitorIds) {
    competitorIds = String(req.query.competitorIds)
      .split(',')
      .map(id => id.trim())
      .filter(id => id !== '' && /^\d+$/.test(id));
  }

  try {
    const followersRows = await db.query(
      `SELECT sf.*, cc.NAME AS COMPANY_NAME 
       FROM SMP_FOLLOWERS sf 
       INNER JOIN COMPA_COMPANIES cc ON sf.COMPANY_ID = cc.COMPANY_ID 
       WHERE sf.COMPANY_ID IN (
         SELECT COMPANY_ID 
         FROM COMPA_COMPETITORS 
         WHERE COMPET_COMPANY_ID = ?
       )`,
      [companyId]
    );

    const companyInfoRows = await db.query(
      `SELECT 
         cc.COMPANY_ID, 
         cc.NAME, 
         cc.INDUSTRY, 
         sf.FB_FOLLOWER_COUNT, 
         sf.INSTA_FOLLOWER_COUNT, 
         sf.LINKEDIN_FOLLOWER_COUNT, 
         sf.GOOGLE_REVIEW_COUNT 
       FROM COMPA_COMPANIES cc 
       JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );

    if (!companyInfoRows || companyInfoRows.length === 0) {
      return res.status(404).json({ error: "Company not found." });
    }

    // If tenant context provided, generate and persist SWOT; otherwise return raw data only
    const userId = req.userId || req.query.userid || null;
    const firmId = req.firmId || req.query.firmid || null;
    let swotAnalysis = null;
    let swotId = null;
    if (userId && firmId) {
      const prompt = generateSWOTPrompt(companyInfoRows, followersRows);
      swotAnalysis = await getSWOTAnalysis(prompt, userId, firmId);
      swotId = await storeSWOT(companyId, 0, swotAnalysis);
      await saveReportToBusinessBooks(companyId, 'swot-analysis', swotAnalysis, userId, firmId);
    }

    res.json({
      followers: followersRows,
      companyInfo: companyInfoRows,
      competitorsFiltered: competitorIds,
      timeRange,
      swotAnalysis,
      swotId,
      swotJson: swotAnalysis,
      tenantApplied: !!(userId && firmId)
    });
  } catch (err) {
    console.error("❌ Error generating/storing SWOT:", err);
    res.status(500).send("Server error");
  }
});

function generateSWOTPrompt(companyInfoRows, followersRows) {
  const company = companyInfoRows[0];
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  

  // Helper for digital footprint line
  function digitalLine(label, count, url) {
    if (count && count > 0) return `${label}: ${count} followers`;
    if (url) return `${label}: Profile exists, follower count not available`;
    return `${label}: No presence`;
  }

  let prompt = `# PROFESSIONAL SWOT ANALYSIS GENERATION

## ANALYSIS DATE
**Current Date:** ${currentDate}
**Important:** All recommendations, timelines, and strategic plans must be realistic and consider current market conditions as of this date.

## ROLE DEFINITION
You are a senior business strategist with 15+ years of experience in competitive analysis and strategic planning. Your expertise includes market research, financial analysis, and strategic business consulting for Fortune 500 companies.

## TASK OBJECTIVE
Generate a comprehensive, data-driven SWOT analysis for **${company.NAME}** (${company.REGION || 'Location not specified'}) in the ${company.INDUSTRY} industry. The analysis must be:
- Factually accurate and evidence-based
- Strategically actionable
- Industry-contextualized
- Competitor-benchmarked
- Error-free and professional-grade

## COMPANY PROFILE
**Target Company:** ${company.NAME}
**Industry Sector:** ${company.INDUSTRY}
**Geographic Region:** ${company.REGION || 'Not specified'}
**Website:** ${company.WEBSITE || 'Not provided'}

**IMPORTANT:** All analysis, recommendations, and strategies must be tailored to the ${company.REGION || 'local'} market. Consider regional market dynamics, local competition, cultural factors, regulatory environment, and consumer behavior specific to this location.

## PERFORMANCE METRICS ANALYSIS

### Social Media Presence:
${digitalLine('Facebook', company.FB_FOLLOWER_COUNT, company.FB_URL)}
${digitalLine('Instagram', company.INSTA_FOLLOWER_COUNT, company.INSTA_URL)}
${digitalLine('LinkedIn', company.LINKEDIN_FOLLOWER_COUNT, company.LINKEDIN_URL)}

### Customer Feedback:
${company.GOOGLE_REVIEW_COUNT && company.GOOGLE_REVIEW_COUNT > 0 ? `Google Reviews Count: ${company.GOOGLE_REVIEW_COUNT}` : (company.GOOGLE_REVIEW_COUNT === 0 ? 'Google Reviews Count: 0' : 'Google Reviews: Not available')}
Average Rating: ${company.GOOGLE_REVIEW_RATING || 'Data unavailable'}

## COMPETITIVE LANDSCAPE ANALYSIS\n`;

  if (followersRows.length > 0) {
    prompt += `### Direct Competitors:\n`;
    followersRows.forEach((comp, index) => {
      prompt += `**${index + 1}. ${comp.COMPANY_NAME || 'Competitor'}**
 Industry: ${comp.INDUSTRY || 'Same sector'}
 Region: ${comp.REGION || 'Not specified'}
 ${digitalLine('Facebook', comp.FB_FOLLOWER_COUNT, comp.FB_URL)}
 ${digitalLine('Instagram', comp.INSTA_FOLLOWER_COUNT, comp.INSTA_URL)}
 ${digitalLine('LinkedIn', comp.LINKEDIN_FOLLOWER_COUNT, comp.LINKEDIN_URL)}
 Google Reviews: ${comp.GOOGLE_REVIEW_COUNT && comp.GOOGLE_REVIEW_COUNT > 0 ? comp.GOOGLE_REVIEW_COUNT : (comp.GOOGLE_REVIEW_COUNT === 0 ? '0' : 'Not available')}

`;
    });
  } else {
    prompt += `### Competitive Data:
No direct competitor data available for comparison. Base analysis on industry standards and general market trends.\n\n`;
  }

  prompt += `## ANALYSIS REQUIREMENTS

### ANALYTICAL FRAMEWORK:
1. **Data Validation**: Verify all metrics against industry benchmarks
2. **Comparative Analysis**: Position company against competitors
3. **Market Context**: Consider current industry trends and market conditions
4. **Strategic Relevance**: Focus on actionable strategic insights
5. **Evidence-Based**: Support each point with specific data or logical reasoning

### OUTPUT SPECIFICATIONS:
Provide analysis in the following JSON format with exactly 4-6 points per category:

\`\`\`json
{
  "Strengths": [
    "Specific strength with supporting metric/evidence",
    "Another strength with quantitative backing"
  ],
  "Weaknesses": [
    "Specific weakness with data support",
    "Another weakness with competitive comparison"
  ],
  "Opportunities": [
    "Market opportunity with strategic rationale",
    "Growth opportunity with implementation pathway"
  ],
  "Threats": [
    "Competitive threat with specific evidence",
    "Market threat with impact assessment"
  ]
}
\`\`\`

### QUALITY STANDARDS:
- Each point must be specific, measurable, and actionable
- Include numerical comparisons where data is available
- Reference industry standards and benchmarks
- Avoid generic statements - be company-specific
- Ensure logical consistency between categories
- Use professional business terminology
- Double-check all numerical references for accuracy

### STRATEGIC FOCUS AREAS:
1. **Digital Presence**: Social media performance and online engagement
2. **Market Position**: Competitive standing and differentiation
3. **Customer Relationship**: Review scores and customer satisfaction
4. **Growth Potential**: Emerging opportunities and expansion areas
5. **Risk Assessment**: Competitive pressures and market challenges
6. **Operational Excellence**: Efficiency and performance metrics

Generate the SWOT analysis now, ensuring each point provides actionable strategic value.`;

  return prompt;
}

// Enhanced Report Generation Function - Compatible with multiple providers
async function generateReportWithGroq(prompt, reportType, apiKeyOverride = null, userId, firmId) {
  if(!userId || !firmId){
    return { type: reportType, content: 'Missing user/firm context', timestamp: new Date().toISOString(), status: 'error' };
  }
  // Get active API key and provider from DB if no override is provided
  let apiKey = apiKeyOverride;
  let provider = null;
  
  if (!apiKey) {
    try {
      const row = await db.queryOne(
        `SELECT API_KEY, LLM_PROVIDER FROM LLM_DETAILS 
         WHERE USERID = ? AND FIRMID = ? AND LLM_PROVIDER_TYPE = ? AND STATUS = 'ACTIVE' 
         ORDER BY UPD_DTM DESC LIMIT 1`,
        [userId, firmId, 'TEXT-TO-TEXT']
      );
      
      if (!row) {
        console.error('❌ No active API key found in database');
        return {
          type: reportType,
          content: `Error: No active API key found. Please add and activate an API key in the API Manager.`,
          timestamp: new Date().toISOString(),
          status: "error"
        };
      }
      
      apiKey = row.API_KEY;
      provider = row.LLM_PROVIDER;
    } catch (err) {
      console.error('❌ Error fetching active API key:', err);
      return {
        type: reportType,
        content: `Error: Could not fetch API key. Please try again.`,
        timestamp: new Date().toISOString(),
        status: "error"
      };
    }
  }

  // Determine API endpoint and model based on provider
  let apiUrl, model, headers, requestBody;
  
  if (provider && provider.toLowerCase().includes('gemini')) {
    // Gemini API configuration
    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    requestBody = {
      contents: [{
        parts: [{
          text: `You are an expert business analyst specializing in ${reportType} reports. Provide detailed, actionable insights in a structured format.\n\n${prompt}`
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      }
    };
  } else {
    // Default to Groq API
    apiUrl = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
    model = "llama-3.1-8b-instant";
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    requestBody = {
      model: model,
      messages: [
        {
          role: "system",
          content: `You are an expert business analyst specializing in ${reportType} reports. Provide detailed, actionable insights in a structured format.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4096,
    };
  }

  try {
    const response = await axios.post(apiUrl, requestBody, { headers });
    
    let content = "";
    if (provider && provider.toLowerCase().includes('gemini')) {
      content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      content = response.data.choices?.[0]?.message?.content || "";
    }
    
    return {
      type: reportType,
      content: content,
      timestamp: new Date().toISOString(),
      status: "success"
    };
  } catch (err) {
    console.error(`❌ Error calling ${provider || 'Groq'} API for ${reportType}:`, err.response?.data || err);
    return {
      type: reportType,
      content: `Error generating ${reportType} report. Please try again.`,
      timestamp: new Date().toISOString(),
      status: "error"
    };
  }
}

async function getSWOTAnalysis(prompt, userId, firmId) {
  if(!userId || !firmId){
    return 'Missing user/firm context for SWOT analysis';
  }
  // Get active API key and provider from database
  let apiKey, provider;
  try {
    const row = await db.queryOne(
      `SELECT API_KEY, LLM_PROVIDER FROM LLM_DETAILS 
       WHERE USERID = ? AND FIRMID = ? AND LLM_PROVIDER_TYPE = ? AND STATUS = 'ACTIVE' 
       ORDER BY UPD_DTM DESC LIMIT 1`,
      [userId, firmId, 'TEXT-TO-TEXT']
    );
    
    if (!row) {
      console.error('❌ No active API key found in database for user', userId, 'firm', firmId);
      return "{}";
    }
    
    apiKey = row.API_KEY;
    provider = row.LLM_PROVIDER;
  } catch (err) {
    console.error('❌ Error fetching API key from database:', err);
    return "{}";
  }

  // Determine API endpoint and configuration based on provider
  let apiUrl, headers, requestBody;
  
  if (provider && provider.toLowerCase().includes('gemini')) {
    // Gemini API configuration
    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    requestBody = {
      contents: [{
        parts: [{
          text: `You ONLY respond in JSON. No explanation. No comments. No text before or after.\n\n${prompt}\n\nIMPORTANT: Only output a JSON object. Do not include any headings or additional text.`
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      }
    };
  } else {
    // Default to Groq API
    apiUrl = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    requestBody = {
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You ONLY respond in JSON. No explanation. No comments. No text before or after.",
        },
        {
          role: "user",
          content: prompt + "\n\nIMPORTANT: Only output a JSON object. Do not include any headings or additional text.",
        },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    };
  }

  try {
    const response = await axios.post(apiUrl, requestBody, { headers });

    let content = "";
    if (provider && provider.toLowerCase().includes('gemini')) {
      content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    } else {
      content = response.data.choices?.[0]?.message?.content || "{}";
    }
    
    const jsonMatch = content.match(/{[\s\S]*}/);
    return jsonMatch ? jsonMatch[0] : "{}";
  } catch (err) {
    console.error(`❌ Error calling ${provider || 'Groq'} API:`, err.response?.data || err);
    return "{}";
  }
}

async function storeSWOT(companyId, productId, swotJsonString) {
  console.log(`📝 Starting SWOT storage for company ID: ${companyId}, product ID: ${productId}`);
  try {
    console.log('🧹 Cleaning JSON string...');
    const cleanedJsonString = swotJsonString.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2028-\u202E]/g, '');
    
    console.log('🔍 Parsing JSON data...');
    const swotData = JSON.parse(cleanedJsonString);
    
    console.log(`🔎 Checking for existing SWOT analysis (Company: ${companyId}, Product: ${productId})...`);
    const existing = await db.queryOne(
      'SELECT SWOT_ID FROM COMPA_SWOT_ANALYSIS WHERE COMPANY_ID = ? AND PRODUCT_ID = ?',
      [companyId, productId]
    );

    if (existing) {
      console.log(`🔄 Updating existing SWOT analysis (ID: ${existing.SWOT_ID})...`);
      await db.execute(
        'UPDATE COMPA_SWOT_ANALYSIS SET STRENGTHS = ?, WEAKNESSES = ?, OPPORTUNITIES = ?, THREATS = ?, UPDATED_AT = NOW() WHERE COMPANY_ID = ? AND PRODUCT_ID = ?',
        [JSON.stringify(swotData.Strengths || []), JSON.stringify(swotData.Weaknesses || []), JSON.stringify(swotData.Opportunities || []), JSON.stringify(swotData.Threats || []), companyId, productId]
      );
      console.log(`✅ Successfully updated SWOT analysis (ID: ${existing.SWOT_ID})`);
      return existing.SWOT_ID;
    } else {
      console.log('➕ Creating new SWOT analysis record...');
      const result = await db.execute(
        'INSERT INTO COMPA_SWOT_ANALYSIS (COMPANY_ID, PRODUCT_ID, STRENGTHS, WEAKNESSES, OPPORTUNITIES, THREATS) VALUES (?, ?, ?, ?, ?, ?)',
        [companyId, productId, JSON.stringify(swotData.Strengths || []), JSON.stringify(swotData.Weaknesses || []), JSON.stringify(swotData.Opportunities || []), JSON.stringify(swotData.Threats || [])]
      );
      console.log(`✅ Successfully created new SWOT analysis (ID: ${result.insertId})`);
      return result.insertId;
    }
  } catch (err) {
    console.error("❌ Error storing SWOT in DB:", err);
    return null;
  }
}

// Prompt Generation Functions
function generateCompetitorAnalysisPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `# COMPREHENSIVE COMPETITOR ANALYSIS REPORT

## ANALYSIS DATE & CONTEXT
**Current Date:** ${currentDate}
**Critical Note:** All competitive strategies, market timing recommendations, and strategic initiatives must be realistic and account for current market conditions as of this date.

## EXECUTIVE CONSULTANT PROFILE
You are a senior management consultant specializing in competitive intelligence and market analysis. You have 15+ years of experience conducting competitor assessments for Fortune 500 companies across multiple industries. Your analysis must meet the highest standards of accuracy and strategic value.

## ASSIGNMENT BRIEF
Conduct a thorough competitive analysis for **${company.NAME}** operating in the **${company.INDUSTRY}** sector. This analysis will inform strategic decision-making at the executive level and must be factually accurate, data-driven, and strategically actionable.

## TARGET COMPANY PROFILE
### Primary Subject:
- **Company Name:** ${company.NAME}
- **Location:** ${company.REGION || 'Not specified'}
- **Industry Classification:** ${company.INDUSTRY}
- **Digital Presence:** ${company.WEBSITE || 'Website not available'}

**CRITICAL:** This is a ${company.REGION || 'local'} market analysis. All competitive insights, market positioning, and strategic recommendations must be specific to the ${company.REGION || 'local'} region. Focus on local market dynamics, regional competitors, and location-specific opportunities.

### Current Performance Metrics:
- **Facebook Engagement:** ${company.FB_FOLLOWER_COUNT || 'Data not available'} followers
- **Instagram Reach:** ${company.INSTA_FOLLOWER_COUNT || 'Data not available'} followers
- **LinkedIn Network:** ${company.LINKEDIN_FOLLOWER_COUNT || 'Data not available'} followers
- **Customer Satisfaction:** ${company.GOOGLE_REVIEW_COUNT || 'Data not available'} Google reviews
 **Customer Satisfaction:** ${company.GOOGLE_REVIEW_COUNT || 'Data not available'} Google reviews

## COMPETITIVE LANDSCAPE INTELLIGENCE

### Identified Competitors:
${competitors.map((comp, index) => `
### Competitor ${index + 1}: ${comp.NAME}
- **Industry Focus:** ${comp.INDUSTRY || 'Same sector as target'}
- **Digital Footprint Analysis:**
  * Facebook: ${comp.FB_FOLLOWER_COUNT || 'Not tracked'} followers
  * Instagram: ${comp.INSTA_FOLLOWER_COUNT || 'Not tracked'} followers
  * LinkedIn: ${comp.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} followers
  * Google Reviews: ${comp.GOOGLE_REVIEW_COUNT || 'Not tracked'}
`).join('')}

## ANALYSIS FRAMEWORK & DELIVERABLES

### Required Analysis Components:
Provide a comprehensive report structured as follows:

#### 1. EXECUTIVE SUMMARY
- Key findings and strategic implications (2-3 paragraphs)
- Critical competitive advantages and vulnerabilities
- Priority action items for management consideration

#### 2. MARKET POSITIONING ANALYSIS
- **Relative Market Position:** Rank all companies by overall digital presence
- **Performance Benchmarking:** Compare key metrics against industry averages
- **Competitive Gaps:** Identify performance differential areas
- **Market Share Implications:** Assess digital footprint impact on market position

#### 3. SOCIAL MEDIA PERFORMANCE MATRIX
- **Platform-by-Platform Analysis:** Detailed comparison across all social channels
- **Engagement Quality Assessment:** Follower-to-engagement ratio analysis
- **Content Strategy Effectiveness:** Platform-specific performance insights
- **Audience Development Trends:** Growth trajectory and momentum analysis

#### 4. COMPETITIVE ADVANTAGES & DISADVANTAGES
- **Core Strengths:** Unique competitive advantages with supporting evidence
- **Critical Weaknesses:** Areas requiring immediate strategic attention
- **Differentiation Opportunities:** Untapped positioning possibilities
- **Vulnerability Assessment:** Competitive threat evaluation

#### 5. STRATEGIC RECOMMENDATIONS
- **Immediate Actions (0-90 days):** High-impact, quick-win initiatives
- **Medium-term Strategy (3-12 months):** Capacity-building recommendations
- **Long-term Vision (1-3 years):** Strategic positioning goals
- **Resource Allocation Priorities:** Investment recommendations by channel

#### 6. KEY INSIGHTS & MARKET INTELLIGENCE
- **Industry Trend Analysis:** Emerging patterns and market shifts
- **Competitive Dynamics:** Relationship mapping and strategic alliances
- **Market Opportunity Assessment:** Unexploited niches and growth areas
- **Risk Factors:** Potential threats and mitigation strategies

## QUALITY ASSURANCE STANDARDS

### Data Accuracy Requirements:
- Verify all numerical comparisons for mathematical accuracy
- Cross-reference metrics against stated industry benchmarks
- Ensure logical consistency throughout the analysis
- Validate strategic recommendations against available data

### Professional Standards:
- Use formal business terminology and consulting language
- Structure content with clear headings and bullet points
- Provide specific, measurable, and actionable recommendations
- Include percentage calculations and ratio analyses where applicable
- Maintain objective, evidence-based analytical tone

### Output Formatting:
- Use markdown formatting for clear structure
- Include tables for numerical comparisons where beneficial
- Organize content in logical, executive-friendly sections
- Ensure each section builds upon previous analysis

Generate the complete competitive analysis report now, ensuring it meets enterprise consulting standards for accuracy and strategic value.`;
}

function generateMarketSharePrompt(marketData) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  if (!marketData) {
    marketData = [];
  } else if (!Array.isArray(marketData)) {
    marketData = [marketData];
  }
  
  return `# PROFESSIONAL MARKET SHARE ANALYSIS

## ANALYSIS DATE & MARKET CONTEXT
**Current Date:** ${currentDate}
**Market Reality Check:** All market projections, growth estimates, and strategic recommendations must reflect realistic market conditions and timelines as of this date.

## SENIOR ANALYST CREDENTIALS
You are a senior market research analyst with 12+ years of experience in quantitative market analysis and competitive intelligence. You specialize in digital market share assessment and have conducted studies for leading consulting firms including McKinsey, BCG, and Deloitte. Your analysis must meet institutional investor-grade standards.

## ANALYTICAL MISSION
Conduct a comprehensive market share analysis using available digital presence indicators as proxy metrics for market positioning. This analysis will inform strategic investment decisions and must demonstrate rigorous analytical methodology.

## MARKET PARTICIPANT DATA
${marketData.length > 0 ? `
### Digital Footprint Analysis:
${marketData.map((company, index) => `
#### Market Player ${index + 1}: ${company.NAME || 'Company ' + (index + 1)} - ${company.REGION || 'Location not specified'}
- **Industry Classification:** ${company.INDUSTRY || 'Not specified'}
- **Geographic Market:** ${company.REGION || 'Not specified'}
- **Digital Presence Metrics:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Data unavailable'}
  * Instagram Audience: ${company.INSTA_FOLLOWER_COUNT || 'Data unavailable'}
  * LinkedIn Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Data unavailable'}
  * Customer Reviews: ${company.GOOGLE_REVIEW_COUNT || 'Data unavailable'}
`).join('')}` : `
### Data Availability Notice:
Limited market participant data available. Analysis will focus on general market dynamics and strategic frameworks applicable to the sector.
`}

## COMPREHENSIVE ANALYSIS REQUIREMENTS

### 1. EXECUTIVE SUMMARY
Provide a 3-paragraph executive overview covering:
- Market composition and key players
- Digital presence implications for market share
- Critical strategic insights for stakeholders

### 2. QUANTITATIVE MARKET SHARE ANALYSIS
#### Digital Market Share Calculations:
- **Methodology Explanation:** Digital proxy metric approach and statistical validity
- **Overall Market Share:** Percentage breakdown by total digital presence
- **Platform-Specific Shares:** Individual channel market distribution
- **Weighted Share Index:** Multi-platform composite scoring
- **Market Concentration Ratios:** CR3, CR5, and HHI calculations

### 3. COMPETITIVE POSITIONING MATRIX
#### Strategic Market Position Assessment:
- **Market Leaders:** Top 3 companies by digital dominance
- **Market Challengers:** Companies with 10-25% market share
- **Market Followers:** Companies with 3-10% market share
- **Market Nichers:** Specialized players with <3% share
- **Competitive Intensity Score:** Market rivalry assessment

### 4. PLATFORM-BY-PLATFORM DOMINANCE ANALYSIS
#### Channel-Specific Market Leadership:
- **Facebook Ecosystem:** Market share distribution and engagement analysis
- **Instagram Visual Market:** Content leadership and audience capture
- **LinkedIn Professional Space:** B2B market presence evaluation
- **Cross-Platform Synergy:** Multi-channel presence effectiveness

### 5. MARKET DYNAMICS & TREND ANALYSIS
#### Growth Pattern Assessment:
- **Market Growth Trajectory:** Digital audience expansion trends
- **Share Migration Patterns:** Competitive position changes over time
- **Platform Maturity Cycles:** Channel lifecycle implications
- **Emerging Opportunity Zones:** Underexploited market segments
- **Saturation Risk Assessment:** Platform-specific ceiling evaluation

### 6. STRATEGIC IMPLICATIONS & RECOMMENDATIONS
#### Actionable Strategic Insights:
- **Market Share Defense Strategies:** For current leaders
- **Share Acquisition Opportunities:** For growth-focused companies
- **Platform Investment Priorities:** Resource allocation recommendations
- **Competitive Response Planning:** Threat mitigation frameworks
- **Market Entry Strategies:** For new competitors

### 7. RISK ASSESSMENT & MARKET INTELLIGENCE
#### Forward-Looking Risk Analysis:
- **Competitive Threat Evaluation:** Emerging challenger assessment
- **Platform Dependency Risks:** Over-concentration vulnerabilities
- **Market Disruption Scenarios:** Technology and trend impact analysis
- **Regulatory Environment Impact:** Policy change implications

## ANALYTICAL RIGOR STANDARDS

### Quantitative Accuracy Requirements:
- Verify all percentage calculations sum to 100% where applicable
- Cross-check market share rankings for mathematical consistency
- Validate competitive position assessments against available data
- Ensure statistical methodology is clearly explained and defensible

### Professional Presentation Standards:
- Structure analysis with clear executive-level headings
- Use professional consulting terminology throughout
- Provide specific, measurable, and actionable recommendations
- Maintain objective, data-driven analytical perspective
- Include confidence levels and limitation acknowledgments

### Quality Assurance Checklist:
- [ ] All calculations mathematically verified
- [ ] Market share totals equal 100%
- [ ] Competitive rankings logically consistent
- [ ] Strategic recommendations evidence-based
- [ ] Professional institutional-grade presentation

Generate the comprehensive market share analysis now, ensuring it meets Fortune 500 consulting standards for accuracy and strategic value.`;
}

function generateContentGapPrompt(contentData) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  if (!contentData) {
    contentData = [];
  } else if (!Array.isArray(contentData)) {
    contentData = [contentData];
  }
  
  return `# STRATEGIC CONTENT GAP ANALYSIS

## ANALYSIS DATE & CONTENT LANDSCAPE
**Current Date:** ${currentDate}
**Content Planning Context:** All content strategies, platform recommendations, and content calendar suggestions must align with current digital trends and realistic production timelines as of this date.

## DIGITAL STRATEGIST PROFILE
You are a senior digital content strategist with 10+ years of experience in content marketing, audience development, and competitive content analysis. You have successfully led content strategies for Fortune 500 companies and digital-native brands, specializing in multi-platform content optimization and audience engagement maximization.

## STRATEGIC ANALYSIS BRIEF
Conduct a comprehensive content gap analysis to identify untapped content opportunities, audience segments, and strategic content positioning advantages. This analysis will inform content investment decisions and editorial calendar development for the next 12 months.

## COMPETITIVE CONTENT LANDSCAPE
${contentData.length > 0 ? `
### Digital Content Ecosystem Analysis:
${contentData.map((company, index) => `
#### Content Player ${index + 1}: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Not specified'}
- **Content Distribution Network:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not tracked'} followers
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not tracked'} followers
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} connections
  * User-Generated Content: ${company.GOOGLE_REVIEW_COUNT || 'Not tracked'} reviews/testimonials
`).join('')}` : `
### Content Analysis Scope:
Limited competitive data available. Analysis will focus on industry best practices and general content strategy frameworks.
`}

## COMPREHENSIVE CONTENT GAP ANALYSIS FRAMEWORK

### 1. EXECUTIVE CONTENT STRATEGY OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Current content landscape competitive positioning
- Primary content gap opportunities identified
- Strategic content investment recommendations

### 2. PLATFORM-SPECIFIC CONTENT GAP IDENTIFICATION
#### Multi-Channel Content Opportunity Assessment:

##### Facebook Content Ecosystem:
- **Content Type Gap Analysis:** Missing content formats and themes
- **Engagement Opportunity Zones:** Underutilized interaction mechanisms
- **Audience Segment Gaps:** Unaddressed demographic or psychographic groups
- **Publishing Frequency Optimization:** Timing and cadence improvements
- **Community Building Opportunities:** Group engagement and discussion facilitation

##### Instagram Visual Content Strategy:
- **Visual Content Format Gaps:** Stories, Reels, IGTV, Carousel opportunities
- **Aesthetic Positioning Opportunities:** Visual style differentiation potential
- **Hashtag Strategy Optimization:** Unexploited hashtag communities
- **User-Generated Content Integration:** Customer content activation strategies
- **Influencer Collaboration Gaps:** Partnership opportunity identification

##### LinkedIn Professional Content Development:
- **Thought Leadership Positioning:** Executive content and industry expertise gaps
- **B2B Content Opportunities:** Decision-maker focused content themes
- **Professional Network Activation:** Employee advocacy and team content
- **Industry Discussion Leadership:** Conversation starting and trend analysis
- **Educational Content Gaps:** Skill development and professional growth content

##### Emerging Platform Content Strategy:


- **Cross-Platform Content Syndication:** Multi-channel content adaptation strategies

### 3. AUDIENCE SEGMENT GAP ANALYSIS
#### Underserved Audience Identification:
- **Demographic Blind Spots:** Age, gender, location, income segment gaps
- **Psychographic Opportunities:** Lifestyle, values, and interest-based segments
- **Behavioral Pattern Analysis:** User journey and engagement preference gaps
- **Customer Lifecycle Content:** Awareness, consideration, decision, retention phase content
- **Micro-Audience Opportunities:** Niche communities and specialized interest groups

### 4. CONTENT THEME & TOPIC OPPORTUNITY MAPPING
#### Strategic Content Pillar Development:
- **Educational Content Gaps:** How-to, tutorial, and informational content opportunities
- **Entertainment Value Addition:** Humor, storytelling, and engaging content formats
- **Inspirational Content Opportunities:** Motivational, aspirational, and lifestyle content
- **Behind-the-Scenes Content:** Transparency, authenticity, and company culture content
- **User-Centric Content:** Customer stories, testimonials, and community-generated content
- **Industry Thought Leadership:** Trend analysis, predictions, and expert commentary

### 5. CONTENT FORMAT & MEDIA GAP ANALYSIS
#### Multi-Media Content Opportunity Assessment:
- **Video Content Opportunities:** Long-form, short-form, live, and interactive video
- **Interactive Content Gaps:** Polls, quizzes, AR/VR, and gamification elements
- **Audio Content Strategy:** Podcasts, voice content, and audio-first platforms
- **Visual Content Enhancement:** Infographics, data visualization, and graphic design
- **Text-Based Content Optimization:** Blog posts, articles, and written thought leadership

### 6. CONTENT CALENDAR & DISTRIBUTION STRATEGY
#### Strategic Content Planning Framework:
- **30-Day Quick Win Content Plan:** Immediate opportunity content schedule
- **90-Day Content Strategy Roadmap:** Medium-term content development plan
- **Annual Content Theme Calendar:** Seasonal, industry events, and awareness campaigns
- **Cross-Platform Content Distribution:** Multi-channel adaptation and timing strategies
- **Content Performance Measurement:** KPI framework and success metrics definition

### 7. COMPETITIVE CONTENT DIFFERENTIATION STRATEGY
#### Unique Positioning Opportunities:
- **White Space Content Areas:** Completely unaddressed content topics
- **Content Quality Enhancement:** Higher production value and expertise demonstration
- **Unique Value Proposition Content:** Proprietary insights and exclusive information
- **Community-Centric Content:** User engagement and interaction-focused content
- **Innovation Content Opportunities:** Cutting-edge formats and experimental approaches

### 8. RESOURCE ALLOCATION & IMPLEMENTATION ROADMAP
#### Strategic Content Investment Framework:
- **High-Impact, Low-Resource Opportunities:** Quick wins and immediate implementations
- **Medium-Term Content Investments:** Capacity building and system development
- **Long-Term Content Vision:** Brand positioning and market leadership content
- **Team Structure Recommendations:** Content creation and management resource needs
- **Technology and Tool Requirements:** Content creation, management, and analytics platforms

## CONTENT STRATEGY EXCELLENCE STANDARDS

### Analytical Rigor Requirements:
- Base all recommendations on specific competitive gap identification
- Provide measurable content performance improvement projections
- Ensure content strategies align with identified audience segment opportunities
- Validate content format recommendations against platform best practices

### Strategic Implementation Focus:
- Prioritize content opportunities by potential ROI and implementation difficulty
- Provide specific, actionable content creation guidelines
- Include content measurement and optimization frameworks
- Ensure scalability and sustainability of recommended content strategies

### Professional Presentation Standards:
- Structure analysis with clear strategic sections and subsections
- Use content marketing industry terminology and best practices
- Provide specific content examples and format recommendations
- Maintain focus on business impact and competitive advantage creation

Generate the comprehensive content gap analysis now, ensuring it provides actionable strategic value for content marketing decision-making.`;
}

function generateTechnicalSEOPrompt(seoData) {
  const { currentDate, dateNote } = getCurrentDateContext();
  
  if (!seoData) {
    seoData = [];
  } else if (!Array.isArray(seoData)) {
    seoData = [seoData];
  }
  
  return `# ENTERPRISE TECHNICAL SEO AUDIT & STRATEGY

## SEO AUDIT DATE & ALGORITHM CONTEXT
${dateNote}
**SEO Reality Check:** All technical recommendations must account for current search algorithm updates and implementation feasibility as of this date.

## TECHNICAL SEO SPECIALIST PROFILE
You are a senior technical SEO consultant with 10+ years of experience in enterprise SEO optimization, website performance engineering, and search algorithm analysis. You have successfully led technical SEO implementations for Fortune 500 companies, managed multi-million dollar organic search strategies, and have deep expertise in Core Web Vitals, crawlability optimization, and technical search ranking factors.

## TECHNICAL SEO ASSESSMENT MISSION
Conduct a comprehensive technical SEO analysis to identify critical performance gaps, search engine optimization opportunities, and technical infrastructure improvements. This audit will provide actionable recommendations to enhance search visibility, improve crawl efficiency, and maximize organic search performance across all major search engines.

## COMPETITIVE TECHNICAL LANDSCAPE
${seoData.length > 0 ? `
### Digital Asset Technical Analysis:
${seoData.map((company, index) => `
#### Technical Entity ${index + 1}: ${company.NAME}
- **Business Sector:** ${company.INDUSTRY || 'Not specified'}
- **Digital Infrastructure:** ${company.WEBSITE || 'Website not provided'}
- **Digital Authority Indicators:**
  * Facebook Technical Integration: ${company.FB_FOLLOWER_COUNT || 'Not analyzed'} social signals
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not analyzed'} media optimization
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not analyzed'} B2B signals
  * User Review Signals: ${company.GOOGLE_REVIEW_COUNT || 'Not analyzed'} local SEO indicators
`).join('')}` : `
### Technical Audit Scope:
Limited competitive technical data available. Analysis will focus on general technical SEO best practices and industry standards.
`}

## COMPREHENSIVE TECHNICAL SEO AUDIT FRAMEWORK

### 1. EXECUTIVE TECHNICAL SEO OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current technical SEO performance assessment and competitive positioning
- Critical technical optimization opportunities identified
- Priority technical implementation roadmap and expected search performance impact

### 2. CORE WEB VITALS & PAGE EXPERIENCE OPTIMIZATION
#### Performance Metrics Technical Analysis:

##### Largest Contentful Paint (LCP) Optimization:
- **Loading Performance Assessment:** Current LCP scores and improvement opportunities
- **Resource Optimization Strategies:** Image compression, font loading, and above-the-fold content
- **Server Response Time Optimization:** Backend performance and hosting infrastructure analysis
- **Critical Resource Prioritization:** CSS, JavaScript, and render-blocking resource optimization
- **Content Delivery Network (CDN) Strategy:** Global performance and edge caching recommendations

##### First Input Delay (FID) & Interaction to Next Paint (INP):
- **JavaScript Performance Optimization:** Bundle analysis, code splitting, and execution timing
- **Third-Party Script Management:** Tag management and external resource impact assessment
- **Browser Main Thread Optimization:** Task scheduling and long-task elimination strategies
- **Interactive Element Optimization:** Button responsiveness and form interaction improvements
- **Progressive Web App (PWA) Implementation:** Service worker and caching strategy optimization

##### Cumulative Layout Shift (CLS) Stabilization:
- **Visual Stability Analysis:** Layout shift identification and elimination strategies
- **Image and Media Optimization:** Aspect ratio preservation and lazy loading implementation
- **Dynamic Content Management:** Ad insertion and dynamic element loading optimization
- **Font Loading Strategy:** Web font optimization and FOUT/FOIT prevention
- **Responsive Design Technical Review:** Viewport and flexible layout optimization

### 3. CRAWLABILITY & INDEXATION TECHNICAL AUDIT
#### Search Engine Access Optimization:

##### XML Sitemap Strategy & Implementation:
- **Sitemap Architecture Analysis:** Structure, priority scoring, and update frequency optimization
- **Index Inclusion Strategy:** Strategic page inclusion and exclusion recommendations
- **Sitemap Submission & Monitoring:** Search Console integration and error monitoring
- **Dynamic Sitemap Generation:** Automated sitemap updates and content discovery
- **Image and Video Sitemap Strategy:** Rich media indexation optimization

##### Robots.txt & Crawl Directive Optimization:
- **Crawl Budget Management:** Strategic crawl directive implementation
- **Directory and File Access Control:** Security and SEO balance optimization
- **User-Agent Specific Directives:** Search engine specific crawl optimization
- **Crawl Delay and Rate Limiting:** Server load and crawl efficiency balance
- **Robots.txt Testing & Validation:** Error detection and directive verification

##### Internal Linking Architecture:
- **Link Equity Distribution:** PageRank flow and authority transfer optimization
- **Anchor Text Strategy:** Descriptive and keyword-optimized internal linking
- **Navigation Structure Optimization:** Menu hierarchy and breadcrumb implementation
- **Orphaned Page Identification:** Content discoverability and link path analysis
- **Link Depth and Click Distance:** Homepage authority distribution optimization

### 4. ON-PAGE TECHNICAL OPTIMIZATION
#### HTML and Structured Data Enhancement:

##### Meta Data and HTML Optimization:
- **Title Tag Technical Analysis:** Length, uniqueness, and keyword optimization
- **Meta Description Strategy:** Click-through rate optimization and snippet enhancement
- **Header Tag Structure:** H1-H6 hierarchy and semantic markup optimization
- **Canonical URL Implementation:** Duplicate content prevention and preferred URL specification
- **URL Structure Optimization:** Clean URLs, keyword inclusion, and hierarchy optimization

##### Structured Data and Schema Markup:
- **Schema.org Implementation:** Rich snippet and knowledge graph optimization
- **JSON-LD Strategy:** Structured data format and implementation best practices
- **Local Business Schema:** NAP consistency and local SEO markup optimization
- **Product and Service Schema:** E-commerce and service business markup strategies
- **FAQ and How-To Schema:** Featured snippet and answer box optimization

### 5. TECHNICAL INFRASTRUCTURE ANALYSIS
#### Server and Hosting Technical Assessment:

##### Server Performance and Configuration:
- **Hosting Infrastructure Analysis:** Server response times and uptime optimization
- **HTTPS Implementation:** SSL certificate management and security optimization
- **HTTP/2 and HTTP/3 Optimization:** Protocol upgrade and performance benefits
- **Compression and Minification:** Gzip, Brotli, and asset optimization strategies
- **Caching Strategy Implementation:** Browser, server, and CDN caching optimization

##### Technical Security and SEO:
- **Website Security Audit:** SSL, malware protection, and security best practices
- **Content Security Policy (CSP):** XSS protection and resource loading security
- **HSTS Implementation:** HTTP Strict Transport Security and browser security
- **Mixed Content Resolution:** HTTPS migration and secure resource loading
- **Security Header Optimization:** Technical SEO and security header implementation

### 6. MOBILE AND MULTI-DEVICE OPTIMIZATION
#### Mobile-First Technical Strategy:

##### Mobile Performance Optimization:
- **Mobile Page Speed Analysis:** Mobile-specific performance bottlenecks and solutions
- **Accelerated Mobile Pages (AMP):** AMP implementation strategy and performance benefits
- **Progressive Web App (PWA) Strategy:** App-like experience and performance optimization
- **Mobile-Friendly Design Validation:** Google Mobile-Friendly Test and optimization
- **Touch and Interaction Optimization:** Mobile user experience and accessibility enhancement

### 7. TECHNICAL SEO MONITORING & MEASUREMENT
#### Performance Tracking and Optimization Framework:

##### Technical SEO KPI Dashboard:
- **Core Web Vitals Monitoring:** Real-time performance tracking and alerting systems
- **Crawl Error Detection:** 404 errors, server errors, and crawlability issue monitoring
- **Index Coverage Analysis:** Search Console data analysis and indexation optimization
- **Page Speed Monitoring:** Performance regression detection and optimization tracking
- **Technical SEO Health Score:** Comprehensive technical performance measurement

##### Competitive Technical Analysis:
- **Technical SEO Benchmarking:** Competitor technical performance comparison
- **Page Speed Competitive Analysis:** Loading performance and optimization opportunities
- **Technical Feature Gap Analysis:** Advanced technical implementation opportunities
- **Search Result Feature Optimization:** Featured snippets, knowledge panels, and rich results
- **Technical SEO ROI Measurement:** Performance improvement impact and business value

## TECHNICAL SEO EXCELLENCE STANDARDS

### Technical Analysis Rigor:
- Base all recommendations on measurable technical performance metrics
- Provide specific implementation guidance with code examples where applicable
- Ensure recommendations align with current search engine guidelines and best practices
- Validate all technical suggestions against Core Web Vitals and search quality standards

### Implementation Focus:
- Prioritize technical optimizations by impact potential and implementation complexity
- Provide clear technical specifications and development requirements
- Include testing and validation procedures for all recommended optimizations
- Ensure scalability and maintainability of technical SEO implementations

### Professional Technical Documentation:
- Structure analysis with clear technical sections and subsections
- Use industry-standard technical SEO terminology and measurement criteria
- Provide specific code examples, configuration details, and implementation guides
- Maintain focus on measurable search performance improvement and business impact

Generate the comprehensive technical SEO audit now, ensuring it provides actionable technical optimization strategies for enterprise-level search performance enhancement.`;
}

function generateUXComparisonPrompt(uxData) {
  const { currentDate, dateNote } = getCurrentDateContext();
  
  if (!uxData) {
    uxData = [];
  } else if (!Array.isArray(uxData)) {
    uxData = [uxData];
  }
  
  return `# COMPREHENSIVE USER EXPERIENCE COMPARATIVE ANALYSIS

## UX ANALYSIS DATE & DESIGN TRENDS
${dateNote}
**UX Context:** All design recommendations must reflect current UX trends, accessibility standards, and user behavior patterns as of this date.

## UX RESEARCH SPECIALIST PROFILE
You are a senior UX research analyst with 10+ years of experience in user experience design, digital product optimization, and comparative UX analysis. You have led UX research initiatives for Fortune 500 companies, managed multi-platform user testing programs, and specialize in conversion optimization, accessibility design, and user journey mapping across web and mobile platforms.

## UX COMPARATIVE ANALYSIS MISSION
Conduct a comprehensive user experience comparative analysis to identify UX strengths, usability gaps, and optimization opportunities across competitive digital touchpoints. This analysis will provide strategic UX recommendations to enhance user satisfaction, improve conversion rates, and establish competitive UX advantages.

## COMPETITIVE UX LANDSCAPE
${uxData.length > 0 ? `
### Digital Experience Ecosystem Analysis:
${uxData.map((company, index) => `
#### UX Entity ${index + 1}: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Not specified'}
- **Digital Presence Infrastructure:** ${company.WEBSITE || 'Website not provided'}
- **User Engagement Indicators:**
  * Facebook Community Engagement: ${company.FB_FOLLOWER_COUNT || 'Not analyzed'} user interactions
  * Instagram Visual Experience: ${company.INSTA_FOLLOWER_COUNT || 'Not analyzed'} visual engagement
  * LinkedIn Professional Interface: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not analyzed'} B2B user experience
  * User Feedback Volume: ${company.GOOGLE_REVIEW_COUNT || 'Not analyzed'} review interactions
`).join('')}` : `
### UX Analysis Scope:
Limited competitive UX data available. Analysis will focus on general UX best practices and industry standards.
`}

## COMPREHENSIVE UX COMPARATIVE FRAMEWORK

### 1. EXECUTIVE UX STRATEGY OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current competitive UX landscape positioning and user experience quality assessment
- Critical UX optimization opportunities and user satisfaction gaps identified
- Strategic UX investment priorities and expected user engagement improvement impact

### 2. INFORMATION ARCHITECTURE & NAVIGATION UX ANALYSIS
#### Structural User Experience Assessment:

##### Website Information Architecture:
- **Navigation Hierarchy Analysis:** Menu structure clarity, logical organization, and user pathway optimization
- **Content Organization Strategy:** Information grouping, categorization effectiveness, and findability assessment
- **Search Functionality Evaluation:** Site search capabilities, filtering options, and results relevance
- **Breadcrumb Implementation:** Navigation trail clarity and user orientation assistance
- **Footer and Utility Navigation:** Secondary navigation effectiveness and user support access

##### User Journey Mapping & Flow Analysis:
- **Primary User Path Analysis:** Critical user journey effectiveness and conversion path optimization
- **Secondary Journey Evaluation:** Supporting user flows and alternative pathway assessment
- **User Task Completion Analysis:** Goal achievement efficiency and friction point identification
- **Cross-Page Experience Continuity:** Consistent user experience across different page types
- **Error Handling and Recovery:** 404 pages, error messaging, and user guidance systems

### 3. VISUAL DESIGN & INTERFACE UX EVALUATION
#### Visual User Experience Comparative Analysis:

##### Visual Design Effectiveness:
- **Brand Consistency Analysis:** Visual identity coherence and brand expression effectiveness
- **Typography and Readability:** Font choices, hierarchy, and content legibility assessment
- **Color Scheme and Contrast:** Visual accessibility, brand alignment, and user preference optimization
- **Imagery and Visual Content:** Photography quality, illustration effectiveness, and visual storytelling
- **White Space and Layout:** Visual breathing room, content organization, and cognitive load management

##### Interactive Element UX Analysis:
- **Button Design and Functionality:** Call-to-action effectiveness, button hierarchy, and interaction feedback
- **Form Design and Usability:** Input field design, validation messaging, and completion ease
- **Interactive Component Analysis:** Dropdowns, modals, carousels, and dynamic element usability
- **Micro-Interaction Design:** Hover states, loading animations, and user feedback mechanisms
- **Visual Affordance Clarity:** User interface element discoverability and interaction predictability

### 4. MOBILE & RESPONSIVE UX ASSESSMENT
#### Multi-Device User Experience Analysis:

##### Mobile-First UX Strategy:
- **Mobile Navigation Optimization:** Touch-friendly navigation, menu accessibility, and mobile user flow
- **Responsive Design Effectiveness:** Cross-device consistency, layout adaptation, and content prioritization
- **Mobile Page Speed and Performance:** Loading times, image optimization, and mobile user patience
- **Touch Interface Design:** Button sizing, gesture support, and mobile interaction optimization
- **Mobile Content Strategy:** Content prioritization, mobile-specific features, and space utilization

##### Cross-Device Experience Continuity:
- **Desktop to Mobile Transition:** User experience consistency across device switching
- **Tablet Experience Optimization:** Mid-size screen adaptation and tablet-specific UX considerations
- **Progressive Web App (PWA) Features:** App-like experience elements and mobile enhancement
- **Offline Functionality:** Network connectivity handling and offline user experience
- **Device-Specific Feature Utilization:** Camera integration, location services, and hardware feature usage

### 5. ACCESSIBILITY & INCLUSIVE DESIGN ANALYSIS
#### Universal User Experience Assessment:

##### Web Accessibility Standards Compliance:
- **WCAG 2.1 AA Compliance Analysis:** Accessibility guideline adherence and barrier identification
- **Screen Reader Compatibility:** Assistive technology support and semantic markup evaluation
- **Keyboard Navigation Support:** Tab order, focus management, and keyboard-only user experience
- **Color Accessibility Assessment:** Color contrast ratios, color-blind user support, and visual accessibility
- **Text and Font Accessibility:** Reading comprehension support, dyslexia-friendly design, and text scaling

##### Inclusive Design Implementation:
- **Multi-Language Support:** Internationalization, localization, and cultural adaptation assessment
- **Age-Inclusive Design:** Senior user accessibility, cognitive load consideration, and interface simplicity
- **Neurodiversity Accommodation:** ADHD, autism, and cognitive processing difference support
- **Low-Bandwidth Optimization:** Limited connectivity user experience and data usage optimization
- **Assistive Technology Integration:** Screen magnifiers, voice control, and adaptive device support

### 6. CONVERSION OPTIMIZATION & USER PSYCHOLOGY
#### Behavioral UX Analysis:

##### Conversion Funnel UX Assessment:
- **Landing Page Effectiveness:** First impression impact, value proposition clarity, and user engagement
- **Product/Service Discovery UX:** Search functionality, filtering options, and recommendation systems
- **Decision-Making Support:** Product comparison tools, reviews integration, and purchase confidence building
- **Checkout and Registration Flow:** Process simplification, trust signals, and abandonment reduction
- **Post-Conversion Experience:** Confirmation messaging, onboarding flow, and user retention UX

##### Psychological UX Principles Application:
- **Cognitive Load Management:** Information processing efficiency and mental effort minimization
- **Trust and Credibility Building:** Security indicators, social proof integration, and authority establishment
- **Urgency and Scarcity Implementation:** FOMO utilization, limited-time offers, and action motivation
- **Social Proof Integration:** Reviews, testimonials, and user-generated content effectiveness
- **Personalization and Customization:** User preference accommodation and individualized experience

### 7. PERFORMANCE & TECHNICAL UX FACTORS
#### Technical User Experience Assessment:

##### Page Load and Performance UX:
- **Core Web Vitals Impact:** Loading performance, interactivity, and visual stability user experience
- **Progressive Loading Strategy:** Content prioritization, skeleton screens, and loading state management
- **Error Handling UX:** Network errors, loading failures, and user communication during issues
- **Caching and Speed Optimization:** User-perceived performance and technical speed improvements
- **Third-Party Integration UX:** External service integration smoothness and user experience continuity

##### Browser and Platform Compatibility:
- **Cross-Browser Consistency:** Chrome, Safari, Firefox, and Edge user experience parity
- **Legacy Browser Support:** Older browser accommodation and graceful degradation
- **Platform-Specific Optimization:** iOS, Android, Windows, and macOS user experience adaptation
- **Search Engine UX Integration:** SERP appearance, rich snippets, and search result optimization
- **Social Media Integration UX:** Sharing functionality, social login, and platform embedding

### 8. COMPETITIVE UX BENCHMARKING & STRATEGIC RECOMMENDATIONS
#### Strategic UX Positioning Analysis:

##### Competitive UX Advantage Identification:
- **UX Differentiation Opportunities:** Unique user experience features and competitive advantage areas
- **Industry UX Standard Assessment:** Best practice adherence and innovation opportunity identification
- **User Expectation Gap Analysis:** Unmet user needs and experience enhancement opportunities
- **Emerging UX Trend Integration:** Next-generation user experience features and technology adoption
- **UX Innovation Potential:** Cutting-edge user experience implementation and market leadership

##### Strategic UX Roadmap Development:
- **Short-Term UX Optimization (30-90 days):** Quick wins and immediate user experience improvements
- **Medium-Term UX Strategy (3-12 months):** Comprehensive UX enhancements and feature development
- **Long-Term UX Vision (1-3 years):** Revolutionary user experience features and market differentiation
- **UX Investment Prioritization:** Resource allocation and impact-effort matrix for UX improvements
- **UX Measurement and KPI Framework:** User satisfaction metrics, conversion optimization tracking, and UX ROI measurement

## UX ANALYSIS EXCELLENCE STANDARDS

### User-Centered Analysis Rigor:
- Base all recommendations on established UX principles and user behavior research
- Provide specific, actionable UX improvements with implementation guidance
- Ensure recommendations align with accessibility standards and inclusive design principles
- Validate UX suggestions against conversion optimization and user satisfaction metrics

### Competitive Analysis Focus:
- Identify specific UX advantages and disadvantages relative to competitors
- Provide measurable UX improvement opportunities and competitive positioning strategies
- Include user testing and validation recommendations for proposed UX changes
- Ensure scalability and feasibility of recommended UX implementations

### Professional UX Documentation:
- Structure analysis with clear UX sections and actionable subsections
- Use industry-standard UX terminology and evaluation criteria
- Provide specific user scenario examples and interaction design recommendations
- Maintain focus on user satisfaction improvement and business impact optimization

Generate the comprehensive UX comparative analysis now, ensuring it provides actionable strategic value for user experience optimization and competitive advantage development.`;
}

function generatePricingComparisonPrompt(pricingData) {
  const { currentDate, dateNote } = getCurrentDateContext();
  
  if (!pricingData) {
    pricingData = [];
  } else if (!Array.isArray(pricingData)) {
    pricingData = [pricingData];
  }
  
  return `# STRATEGIC PRICING INTELLIGENCE & COMPETITIVE ANALYSIS

## PRICING ANALYSIS DATE & MARKET CONDITIONS
${dateNote}
**Pricing Context:** All pricing strategies must consider current economic conditions, market inflation trends, and competitive pricing movements as of this date.

## PRICING STRATEGY CONSULTANT PROFILE
You are a senior pricing strategy consultant with 10+ years of experience in competitive pricing analysis, revenue optimization, and pricing psychology. You have led pricing transformations for Fortune 500 companies, developed dynamic pricing models for multiple industries, and specialize in value-based pricing strategies, price elasticity analysis, and competitive positioning optimization.

## PRICING STRATEGY ANALYSIS MISSION
Conduct a comprehensive competitive pricing analysis to identify pricing advantages, revenue optimization opportunities, and strategic pricing positioning. This analysis will provide actionable pricing recommendations to maximize revenue, improve market competitiveness, and establish optimal pricing strategies across all product and service offerings.

## COMPETITIVE PRICING LANDSCAPE
${pricingData.length > 0 ? `
### Market Pricing Ecosystem Analysis:
${pricingData.map((company, index) => `
#### Pricing Entity ${index + 1}: ${company.NAME}
- **Industry Sector:** ${company.INDUSTRY || 'Not specified'}
- **Digital Market Presence:** ${company.WEBSITE || 'Website not provided'}
- **Market Authority Indicators:**
  * Facebook Community Size: ${company.FB_FOLLOWER_COUNT || 'Not analyzed'} market reach
  * Instagram Brand Presence: ${company.INSTA_FOLLOWER_COUNT || 'Not analyzed'} visual engagement
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not analyzed'} B2B authority
  * Customer Satisfaction Volume: ${company.GOOGLE_REVIEW_COUNT || 'Not analyzed'} feedback indicators
`).join('')}` : `
### Pricing Analysis Scope:
Limited competitive pricing data available. Analysis will focus on general pricing strategy frameworks and industry standards.
`}

## COMPREHENSIVE PRICING STRATEGY FRAMEWORK

### 1. EXECUTIVE PRICING STRATEGY OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current competitive pricing landscape and market positioning assessment
- Critical pricing optimization opportunities and revenue enhancement potential
- Strategic pricing implementation roadmap and expected financial impact

### 2. COMPETITIVE PRICING MODEL ANALYSIS
#### Pricing Strategy Architecture Assessment:

##### Pricing Model Structure Evaluation:
- **Subscription vs. One-Time Pricing:** Recurring revenue models and customer lifetime value optimization
- **Freemium and Trial Strategy:** Customer acquisition pricing and conversion funnel analysis
- **Tiered Pricing Architecture:** Service level differentiation and value ladder construction
- **Usage-Based Pricing Models:** Consumption-driven pricing and scalability frameworks
- **Bundle and Package Strategy:** Product combination pricing and cross-selling optimization

##### Value-Based Pricing Assessment:
- **Customer Value Perception:** Price-to-value ratio analysis and perceived benefit evaluation
- **Price Sensitivity Analysis:** Demand elasticity and optimal pricing point identification
- **Market Positioning Pricing:** Premium, economy, and mid-market pricing strategy evaluation
- **Competitive Price Benchmarking:** Direct competitor pricing comparison and positioning analysis
- **Dynamic Pricing Opportunities:** Market-responsive pricing and demand-based adjustments

### 3. PRICING TRANSPARENCY & COMMUNICATION ANALYSIS
#### Pricing Presentation Strategy Assessment:

##### Pricing Display and Accessibility:
- **Pricing Page Design:** Information architecture, clarity, and conversion optimization
- **Price Communication Strategy:** Transparency levels, hidden fees disclosure, and trust building
- **Pricing Calculator Tools:** Self-service pricing tools and customer empowerment features
- **Quote and Proposal Process:** B2B pricing communication and sales enablement tools
- **Mobile Pricing Experience:** Mobile-optimized pricing display and purchasing flow

##### Pricing Psychology Implementation:
- **Anchoring Strategy Analysis:** Price positioning and reference point establishment
- **Decoy Pricing Effectiveness:** Option architecture and choice architecture optimization
- **Charm Pricing Usage:** Psychological pricing tactics and consumer behavior influence
- **Social Proof Integration:** Customer testimonials, case studies, and pricing validation
- **Urgency and Scarcity Tactics:** Limited-time offers and availability-based pricing pressure

### 4. CUSTOMER SEGMENTATION & PRICING STRATEGY
#### Market Segment Pricing Optimization:

##### Customer Segment Price Differentiation:
- **B2B vs. B2C Pricing Strategy:** Business and consumer pricing model differences
- **SMB, Mid-Market, Enterprise Pricing:** Size-based pricing and value delivery scaling
- **Geographic Pricing Strategy:** Regional pricing optimization and local market adaptation
- **Industry-Specific Pricing:** Vertical market pricing and specialized solution pricing
- **Customer Lifecycle Pricing:** Acquisition, retention, and expansion pricing strategies

##### Personalization and Dynamic Pricing:
- **Customer Behavior-Based Pricing:** Usage patterns and engagement-driven pricing
- **Loyalty Program Integration:** Retention pricing and customer value optimization
- **Volume Discount Strategy:** Bulk purchasing incentives and relationship pricing
- **Contract Length Optimization:** Commitment-based pricing and long-term value capture
- **Upgrade and Upselling Pricing:** Growth pricing strategy and revenue expansion

### 5. PRICING OPERATIONS & TECHNOLOGY ANALYSIS
#### Pricing Infrastructure Assessment:

##### Pricing System and Technology:
- **Pricing Management Platforms:** Automated pricing tools and system integration
- **A/B Testing Infrastructure:** Price optimization testing and data-driven decision making
- **Revenue Management Systems:** Pricing analytics and performance monitoring tools
- **Integration with Sales/CRM:** Pricing workflow and sales process optimization
- **Payment Processing Strategy:** Transaction fees, payment methods, and conversion optimization

##### Pricing Analytics and Intelligence:
- **Competitive Price Monitoring:** Real-time competitor pricing tracking and alert systems
- **Price Performance Analytics:** Revenue impact measurement and pricing effectiveness
- **Customer Price Sensitivity Analysis:** Demand response modeling and elasticity measurement
- **Margin and Profitability Analysis:** Cost structure optimization and profit maximization
- **Pricing Forecast and Modeling:** Predictive pricing and revenue projection capabilities

### 6. REVENUE OPTIMIZATION & GROWTH STRATEGY
#### Pricing-Driven Revenue Enhancement:

##### Revenue Model Innovation:
- **Hybrid Pricing Strategy:** Multiple revenue stream integration and diversification
- **Platform and Marketplace Pricing:** Multi-sided market pricing and commission strategies
- **API and Integration Pricing:** Technology service pricing and developer ecosystem monetization
- **Data and Analytics Pricing:** Information product pricing and value extraction strategies
- **Consulting and Professional Services:** Service pricing and expertise monetization

##### Pricing Experimentation and Optimization:
- **Price Testing Framework:** Systematic price optimization and experimentation methodology
- **Market Penetration Pricing:** Growth-focused pricing and market share capture strategies
- **Premium Positioning Strategy:** High-value pricing and luxury market positioning
- **Competitive Response Planning:** Pricing warfare prevention and strategic response preparation
- **Expansion Pricing Strategy:** Geographic and product expansion pricing frameworks

### 7. CUSTOMER VALUE PROPOSITION & PRICING ALIGNMENT
#### Value-Price Optimization Strategy:

##### Value Communication and Justification:
- **ROI Demonstration Tools:** Customer value calculation and investment justification
- **Cost Comparison Frameworks:** Total cost of ownership and competitive cost analysis
- **Value Proposition Articulation:** Benefit communication and price-value alignment
- **Customer Success Story Integration:** Case study pricing validation and social proof
- **Industry Benchmark Communication:** Market standard pricing and competitive positioning

##### Pricing Objection Handling:
- **Sales Enablement Tools:** Pricing conversation training and objection response frameworks
- **Value-Based Selling Support:** Consultative pricing and customer-centric selling strategies
- **Negotiation Framework:** Pricing flexibility guidelines and win-win negotiation strategies
- **Competitive Comparison Tools:** Direct competitor analysis and differentiation frameworks
- **Pricing FAQ and Resources:** Customer education and self-service pricing information

### 8. STRATEGIC PRICING RECOMMENDATIONS & ROADMAP
#### Pricing Optimization Implementation Plan:

##### Short-Term Pricing Optimization (30-90 days):
- **Quick Win Pricing Adjustments:** Immediate revenue impact opportunities and low-risk optimizations
- **Pricing Page Enhancement:** Conversion rate optimization and clarity improvements
- **Competitive Price Positioning:** Market alignment and strategic price adjustments
- **Pricing Communication Improvement:** Transparency enhancement and trust building measures
- **A/B Testing Implementation:** Price optimization experimentation and data collection

##### Medium-Term Pricing Strategy (3-12 months):
- **Pricing Model Transformation:** Revenue model optimization and strategic pricing shifts
- **Customer Segmentation Pricing:** Targeted pricing strategy and segment optimization
- **Technology and Analytics Implementation:** Pricing system enhancement and data-driven optimization
- **Sales Process Integration:** Pricing workflow optimization and team training programs
- **Competitive Intelligence Development:** Market monitoring and strategic response capabilities

##### Long-Term Pricing Vision (1-3 years):
- **Dynamic Pricing Implementation:** AI-driven pricing and real-time optimization capabilities
- **Market Leadership Pricing:** Industry-leading pricing innovation and competitive advantage
- **Global Pricing Strategy:** International expansion pricing and multi-market optimization
- **Platform Ecosystem Pricing:** Partner and integration pricing strategy development
- **Pricing Culture Development:** Organization-wide pricing excellence and continuous optimization

## PRICING STRATEGY EXCELLENCE STANDARDS

### Financial Analysis Rigor:
- Base all recommendations on quantitative pricing analysis and revenue impact projections
- Provide specific pricing implementation guidance with financial modeling support
- Ensure recommendations align with market positioning and competitive differentiation goals
- Validate pricing suggestions against customer value perception and willingness to pay

### Strategic Implementation Focus:
- Prioritize pricing optimizations by revenue impact potential and implementation feasibility
- Provide clear pricing change management and rollout strategies
- Include customer communication and change management frameworks
- Ensure scalability and sustainability of recommended pricing strategies

### Professional Pricing Documentation:
- Structure analysis with clear pricing strategy sections and actionable subsections
- Use industry-standard pricing terminology and evaluation methodologies
- Provide specific pricing examples, calculation frameworks, and implementation guides
- Maintain focus on revenue optimization and competitive market positioning

Generate the comprehensive pricing strategy analysis now, ensuring it provides actionable strategic value for revenue optimization and competitive pricing advantage development.`;
}

function generateBrandPresencePrompt(brandData) {
  if (!brandData) {
    brandData = [];
  } else if (!Array.isArray(brandData)) {
    brandData = [brandData];
  }
  
  return `# COMPREHENSIVE BRAND PRESENCE & DIGITAL VISIBILITY ANALYSIS

## BRAND STRATEGY CONSULTANT PROFILE
You are a senior brand strategist with 10+ years of experience in brand development, digital presence optimization, and multi-channel brand management. You have led brand transformation initiatives for Fortune 500 companies, managed global brand campaigns across multiple touchpoints, and specialize in brand equity measurement, competitive brand positioning, and omnichannel brand experience optimization.

## BRAND PRESENCE ASSESSMENT MISSION
Conduct a comprehensive brand presence analysis to evaluate brand visibility, digital footprint effectiveness, and competitive brand positioning across all major touchpoints. This analysis will provide strategic recommendations to enhance brand recognition, improve brand consistency, and maximize brand impact across digital and traditional channels.

## COMPETITIVE BRAND LANDSCAPE
${brandData.length > 0 ? `
### Brand Ecosystem Competitive Analysis:
${brandData.map((company, index) => `
#### Brand Entity ${index + 1}: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Not specified'}
- **Multi-Channel Brand Footprint:**
  * Facebook Brand Community: ${company.FB_FOLLOWER_COUNT || 'Not analyzed'} brand advocates
  * Instagram Visual Brand Identity: ${company.INSTA_FOLLOWER_COUNT || 'Not analyzed'} visual engagement
  * LinkedIn Professional Brand Authority: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not analyzed'} B2B brand presence
  * Customer Brand Testimonials: ${company.GOOGLE_REVIEW_COUNT || 'Not analyzed'} brand advocacy indicators
`).join('')}` : `
### Brand Analysis Scope:
Limited competitive brand data available. Analysis will focus on general brand strategy frameworks and industry best practices.
`}

## COMPREHENSIVE BRAND PRESENCE FRAMEWORK

### 1. EXECUTIVE BRAND STRATEGY OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current competitive brand landscape and brand equity positioning assessment
- Critical brand presence opportunities and visibility enhancement potential
- Strategic brand investment priorities and expected brand impact improvements

### 2. MULTI-CHANNEL BRAND VISIBILITY ANALYSIS
#### Cross-Platform Brand Presence Assessment:

##### Digital Brand Ecosystem Evaluation:
- **Social Media Brand Consistency:** Visual identity, messaging, and brand voice alignment across platforms
- **Brand Reach and Awareness:** Audience size, engagement quality, and brand mention frequency analysis
- **Content Brand Alignment:** Brand value expression, personality consistency, and message coherence
- **Platform-Specific Brand Adaptation:** Channel-optimized brand expression while maintaining core identity
- **Cross-Channel Brand Integration:** Coordinated brand campaigns and unified brand experience delivery

##### Search and Discovery Brand Presence:
- **Organic Search Brand Visibility:** Brand keyword rankings, search result presence, and brand SERP control
- **Paid Search Brand Strategy:** Brand advertising investment, competitor brand bidding, and search dominance
- **Local Search Brand Optimization:** Google My Business, local directory presence, and geographic brand visibility
- **Voice Search Brand Readiness:** Conversational brand queries and smart device brand discovery
- **Visual Search Brand Integration:** Image recognition, Pinterest presence, and visual brand discovery optimization

### 3. BRAND IDENTITY & MESSAGING CONSISTENCY ANALYSIS
#### Brand Expression Coherence Assessment:

##### Visual Brand Identity Evaluation:
- **Logo and Brand Mark Usage:** Consistency, recognition, and visual impact across all touchpoints
- **Color Palette and Typography:** Brand guideline adherence and visual identity maintenance
- **Photography and Visual Style:** Brand aesthetic consistency and visual storytelling effectiveness
- **Graphic Design Standards:** Marketing material consistency and professional brand presentation
- **Video and Motion Graphics:** Brand animation standards and multimedia brand expression quality

##### Brand Voice and Messaging Analysis:
- **Tone of Voice Consistency:** Communication style alignment and personality expression across channels
- **Brand Messaging Framework:** Core value proposition delivery and key message consistency
- **Content Brand Alignment:** Editorial content reflection of brand values and positioning
- **Customer Communication Style:** Service interaction brand voice and support communication quality
- **Crisis Communication Brand Management:** Brand reputation protection and consistent messaging during challenges

### 4. AUDIENCE ENGAGEMENT & BRAND AFFINITY ANALYSIS
#### Brand Relationship Quality Assessment:

##### Customer Brand Engagement Evaluation:
- **Brand Community Building:** Fan base development, brand advocate cultivation, and community management
- **User-Generated Content (UGC):** Customer brand content creation and organic brand promotion
- **Brand Loyalty Indicators:** Repeat engagement, brand mention sentiment, and customer retention signals
- **Influencer Brand Partnerships:** Brand collaboration effectiveness and influencer brand alignment
- **Brand Event and Experience:** In-person and virtual brand experience quality and impact measurement

##### Brand Sentiment and Reputation Analysis:
- **Online Brand Sentiment Tracking:** Social listening, review sentiment, and brand perception monitoring
- **Brand Crisis Management Effectiveness:** Negative feedback response and brand reputation recovery
- **Competitive Brand Sentiment Comparison:** Relative brand perception and industry reputation standing
- **Brand Trust and Credibility Indicators:** Customer testimonials, expert endorsements, and trust signals
- **Brand Authenticity Perception:** Genuine brand expression and authentic customer relationship building

### 5. COMPETITIVE BRAND POSITIONING ANALYSIS
#### Brand Differentiation Strategy Assessment:

##### Brand Unique Value Proposition:
- **Brand Differentiation Clarity:** Unique selling proposition communication and competitive advantage expression
- **Brand Category Leadership:** Industry thought leadership and brand authority establishment
- **Brand Innovation Communication:** New product/service launch brand integration and innovation messaging
- **Brand Heritage and Story:** Company history leveraging and brand narrative development effectiveness
- **Brand Purpose and Values:** Social responsibility communication and purpose-driven brand positioning

##### Competitive Brand Landscape Analysis:
- **Direct Competitor Brand Comparison:** Head-to-head brand strength analysis and positioning gaps
- **Indirect Competitor Brand Monitoring:** Adjacent industry brand threat assessment and opportunity identification
- **Brand Share of Voice:** Marketing communication volume and brand visibility competitive analysis
- **Brand Recall and Recognition Testing:** Aided and unaided brand awareness competitive benchmarking
- **Brand Preference and Consideration:** Purchase decision influence and brand selection probability analysis

### 6. BRAND EXPERIENCE & TOUCHPOINT OPTIMIZATION
#### Omnichannel Brand Experience Analysis:

##### Customer Journey Brand Touchpoints:
- **Awareness Stage Brand Presence:** Discovery touchpoint brand impression and initial brand perception
- **Consideration Stage Brand Information:** Evaluation phase brand content and decision-making brand influence
- **Purchase Stage Brand Experience:** Transaction brand interaction and conversion brand optimization
- **Post-Purchase Brand Relationship:** Customer success brand communication and loyalty brand building
- **Advocacy Stage Brand Amplification:** Customer referral brand programs and word-of-mouth brand enhancement

##### Digital Brand Experience Quality:
- **Website Brand Expression:** Homepage brand impact, navigation brand consistency, and content brand alignment
- **Mobile Brand Experience:** App design brand integration and mobile-optimized brand presentation
- **Email Brand Communication:** Newsletter design, promotional material brand consistency, and automation brand voice
- **Social Media Brand Interaction:** Response quality, engagement brand voice, and community brand management
- **Customer Service Brand Representation:** Support interaction brand standards and problem resolution brand impact

### 7. BRAND PERFORMANCE MEASUREMENT & ANALYTICS
#### Brand Impact Tracking and Optimization:

##### Brand Awareness and Recognition Metrics:
- **Brand Recall Testing:** Unaided brand awareness measurement and competitive brand recall comparison
- **Brand Recognition Assessment:** Logo recognition, brand association testing, and visual identity effectiveness
- **Brand Mention Tracking:** Social media mentions, news coverage, and online brand conversation monitoring
- **Search Volume Brand Analysis:** Brand keyword search trends and brand-related query volume tracking
- **Brand Survey and Research:** Customer perception surveys and brand health tracking methodologies

##### Brand Engagement and Loyalty Analytics:
- **Social Media Brand Metrics:** Engagement rates, follower growth, and brand content performance analysis
- **Customer Lifetime Value (CLV):** Brand loyalty impact on revenue and long-term customer relationship value
- **Net Promoter Score (NPS):** Brand advocacy measurement and customer recommendation likelihood
- **Brand Sentiment Analysis:** Positive/negative brand mention tracking and sentiment trend monitoring
- **Competitive Brand Benchmarking:** Relative brand performance measurement and industry brand leadership tracking

### 8. STRATEGIC BRAND OPTIMIZATION ROADMAP
#### Brand Presence Enhancement Implementation Plan:

##### Short-Term Brand Optimization (30-90 days):
- **Brand Consistency Audit:** Cross-channel brand alignment correction and immediate consistency improvements
- **High-Impact Brand Touchpoint Enhancement:** Priority channel brand presence optimization and quick wins
- **Brand Messaging Refinement:** Core message clarity improvement and value proposition strengthening
- **Social Media Brand Strategy:** Platform-specific brand optimization and engagement enhancement tactics
- **Brand Monitoring System Implementation:** Brand tracking tool setup and competitive brand surveillance

##### Medium-Term Brand Strategy (3-12 months):
- **Comprehensive Brand Guideline Development:** Complete brand standard documentation and team training
- **Multi-Channel Brand Campaign Integration:** Coordinated brand campaign across all digital touchpoints
- **Brand Content Strategy Enhancement:** Brand-aligned content calendar and storytelling framework
- **Customer Experience Brand Integration:** Service touchpoint brand optimization and experience standardization
- **Brand Partnership and Collaboration Strategy:** Influencer relationships and brand alliance development

##### Long-Term Brand Vision (1-3 years):
- **Brand Equity Building Program:** Systematic brand value enhancement and market positioning strengthening
- **Emerging Channel Brand Expansion:** New platform brand presence and next-generation touchpoint preparation
- **Brand Innovation and Evolution:** Brand refresh planning and future brand strategy development
- **Global Brand Expansion Strategy:** International brand presence and cultural adaptation frameworks
- **Brand Legacy and Heritage Development:** Long-term brand story cultivation and industry leadership establishment

## BRAND STRATEGY EXCELLENCE STANDARDS

### Brand Analysis Rigor:
- Base all recommendations on measurable brand performance metrics and customer perception data
- Provide specific brand enhancement strategies with implementation timelines and resource requirements
- Ensure recommendations align with brand equity building and competitive differentiation goals
- Validate brand suggestions against customer brand preference and market positioning objectives

### Strategic Brand Implementation Focus:
- Prioritize brand optimizations by impact potential on brand awareness and customer loyalty
- Provide clear brand guideline development and brand management training recommendations
- Include brand measurement frameworks and continuous brand optimization strategies
- Ensure scalability and sustainability of recommended brand presence enhancements

### Professional Brand Documentation:
- Structure analysis with clear brand strategy sections and actionable implementation subsections
- Use industry-standard brand terminology and evaluation methodologies
- Provide specific brand examples, visual guidelines, and communication frameworks
- Maintain focus on brand equity building and competitive brand advantage development

Generate the comprehensive brand presence analysis now, ensuring it provides actionable strategic value for brand optimization and competitive brand positioning enhancement.`;
}

function generateAudienceOverlapPrompt(audienceData) {
  if (!audienceData) {
    audienceData = [];
  } else if (!Array.isArray(audienceData)) {
    audienceData = [audienceData];
  }
  
  return `# STRATEGIC AUDIENCE OVERLAP & TARGETING INTELLIGENCE

## AUDIENCE RESEARCH SPECIALIST PROFILE
You are a senior audience research analyst with 10+ years of experience in consumer behavior analysis, demographic segmentation, and competitive audience intelligence. You have led audience research initiatives for Fortune 500 companies, managed multi-platform audience development programs, and specialize in cross-platform audience mapping, behavioral targeting optimization, and customer acquisition strategy development.

## AUDIENCE OVERLAP ANALYSIS MISSION
Conduct a comprehensive audience overlap analysis to identify shared customer segments, unique audience characteristics, and strategic targeting opportunities across competitive landscape. This analysis will provide actionable audience insights to optimize customer acquisition, improve targeting precision, and identify untapped audience segments for growth expansion.

## COMPETITIVE AUDIENCE LANDSCAPE
${audienceData.length > 0 ? `
### Multi-Platform Audience Ecosystem Analysis:
${audienceData.map((company, index) => `
#### Audience Entity ${index + 1}: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Not specified'}
- **Cross-Platform Audience Footprint:**
  * Facebook Community Audience: ${company.FB_FOLLOWER_COUNT || 'Not analyzed'} engaged community members
  * Instagram Visual Audience: ${company.INSTA_FOLLOWER_COUNT || 'Not analyzed'} visual content consumers
  * LinkedIn Professional Audience: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not analyzed'} B2B decision makers
  * Customer Feedback Community: ${company.GOOGLE_REVIEW_COUNT || 'Not analyzed'} active reviewers
`).join('')}` : `
### Audience Analysis Scope:
Limited competitive audience data available. Analysis will focus on general audience research frameworks and industry targeting standards.
`}

## COMPREHENSIVE AUDIENCE OVERLAP FRAMEWORK

### 1. EXECUTIVE AUDIENCE INTELLIGENCE OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current competitive audience landscape and cross-platform audience distribution analysis
- Critical audience overlap opportunities and unique targeting segment identification
- Strategic audience acquisition priorities and expected customer growth impact

### 2. DEMOGRAPHIC AUDIENCE OVERLAP ANALYSIS
#### Cross-Platform Demographic Segmentation Assessment:

##### Age and Generational Audience Mapping:
- **Gen Z Audience Overlap (18-26):** Platform preferences, content consumption patterns, and brand engagement behaviors
- **Millennial Audience Analysis (27-42):** Professional status, spending power, and multi-platform usage patterns
- **Gen X Audience Characteristics (43-58):** Family life stage, career positioning, and technology adoption patterns
- **Baby Boomer Audience Segments (59+):** Retirement planning, healthcare interests, and digital platform comfort levels
- **Cross-Generational Audience Opportunities:** Multi-age targeting strategies and family influence dynamics

##### Geographic and Regional Audience Distribution:
- **Urban vs. Rural Audience Preferences:** Location-based content preferences and platform usage differences
- **Regional Market Audience Characteristics:** Cultural preferences, local interests, and geographic targeting opportunities
- **International Audience Overlap:** Global market segments and cross-border audience expansion potential
- **Time Zone and Seasonal Audience Behavior:** Engagement timing optimization and seasonal audience shifts
- **Local Community Audience Integration:** Neighborhood-level targeting and community-based audience development

### 3. PSYCHOGRAPHIC AUDIENCE SEGMENTATION ANALYSIS
#### Behavioral and Interest-Based Audience Overlap:

##### Lifestyle and Values-Based Audience Mapping:
- **Health and Wellness Audience Segments:** Fitness enthusiasts, mental health advocates, and nutrition-focused consumers
- **Technology and Innovation Adopters:** Early adopters, tech professionals, and digital transformation leaders
- **Sustainability and Environmental Audiences:** Eco-conscious consumers, green technology advocates, and sustainable lifestyle practitioners
- **Entertainment and Media Consumption Patterns:** Content preferences, streaming behaviors, and entertainment platform usage
- **Financial and Investment Interest Audiences:** Personal finance enthusiasts, investment learners, and wealth building communities

##### Professional and Career-Focused Audience Analysis:
- **Industry-Specific Professional Segments:** Healthcare workers, educators, technology professionals, and service industry audiences
- **Career Development and Education Audiences:** Skill development seekers, professional growth enthusiasts, and certification pursuers
- **Entrepreneurship and Business Owner Segments:** Startup founders, small business owners, and franchise operators
- **Remote Work and Digital Nomad Communities:** Location-independent professionals and flexible work advocates
- **Leadership and Management Audience Overlap:** Executive decision makers, team leaders, and organizational development professionals

### 4. PLATFORM-SPECIFIC AUDIENCE BEHAVIOR ANALYSIS
#### Cross-Platform Audience Engagement Patterns:

##### Social Media Platform Audience Characteristics:
- **Facebook Audience Behavior:** Community engagement, group participation, and long-form content consumption
- **Instagram Audience Preferences:** Visual content consumption, story engagement, and influencer following patterns
- **LinkedIn Professional Audience:** B2B networking, thought leadership consumption, and professional development engagement

##### Content Consumption and Engagement Patterns:
- **Video Content Audience Preferences:** Long-form vs. short-form video consumption and educational vs. entertainment preferences
- **Text-Based Content Audience Engagement:** Blog reading, article sharing, and written content consumption patterns
- **Interactive Content Audience Participation:** Quiz engagement, poll participation, and user-generated content creation
- **Live Content and Real-Time Engagement:** Live streaming consumption, real-time interaction, and event participation patterns
- **Mobile vs. Desktop Audience Behavior:** Device-specific content consumption and platform usage optimization

### 5. COMPETITIVE AUDIENCE ACQUISITION ANALYSIS
#### Audience Capture and Retention Strategy Assessment:

##### Shared Audience Segment Competition:
- **Direct Audience Overlap Identification:** Exact customer segment competition and audience acquisition battlegrounds
- **Audience Loyalty and Switching Behavior:** Customer retention strength and competitor audience migration patterns
- **Value Proposition Audience Alignment:** Message resonance and audience preference competitive analysis
- **Pricing Sensitivity Audience Segments:** Budget-conscious audiences and premium market audience distribution
- **Brand Affinity and Audience Attachment:** Emotional connection strength and brand switching resistance analysis

##### Unique Audience Opportunity Identification:
- **Underserved Audience Segments:** Unaddressed customer needs and market gap audience opportunities
- **Emerging Audience Trends:** Next-generation customer segments and evolving audience behavior patterns
- **Niche Audience Communities:** Specialized interest groups and micro-audience targeting opportunities
- **Cross-Industry Audience Expansion:** Adjacent market audience capture and industry boundary crossing
- **Platform Migration Audience Opportunities:** Audience movement between platforms and early adoption advantages

### 6. CUSTOMER JOURNEY & AUDIENCE LIFECYCLE ANALYSIS
#### Multi-Stage Audience Development Assessment:

##### Awareness Stage Audience Characteristics:
- **Discovery Channel Preferences:** How different audience segments first encounter brands and content
- **Information Seeking Behavior:** Research patterns, content consumption, and decision-making information requirements
- **Influencer and Peer Influence Patterns:** Social proof requirements and recommendation source preferences
- **Content Format Preferences:** Educational content, entertainment content, and mixed-format consumption patterns
- **Timing and Frequency Preferences:** Optimal engagement timing and communication frequency tolerance

##### Conversion and Retention Audience Analysis:
- **Purchase Decision Factors:** Price sensitivity, feature importance, and decision-making criteria by audience segment
- **Onboarding and Experience Preferences:** Customer success requirements and support preference patterns
- **Loyalty Program Engagement:** Retention strategy effectiveness and reward system audience preferences
- **Advocacy and Referral Behavior:** Word-of-mouth patterns and customer testimonial creation willingness
- **Long-Term Relationship Development:** Customer lifecycle management and audience evolution tracking

### 7. TARGETING PRECISION & ACQUISITION STRATEGY
#### Audience Targeting Optimization Framework:

##### Lookalike Audience Development:
- **High-Value Customer Characteristics:** Premium customer segment identification and replication strategies
- **Conversion-Optimized Audience Building:** Purchase behavior patterns and conversion likelihood modeling
- **Engagement-Based Audience Expansion:** High-engagement user characteristics and audience quality optimization
- **Lifetime Value Audience Targeting:** Long-term customer value prediction and acquisition cost optimization
- **Multi-Platform Audience Synchronization:** Cross-channel audience consistency and unified targeting approaches

##### Custom Audience Segmentation Strategy:
- **Behavioral Trigger Audience Creation:** Action-based audience segmentation and re-engagement targeting
- **Interest-Based Micro-Targeting:** Specific interest combination targeting and niche audience development
- **Geographic and Demographic Combination Targeting:** Multi-variable audience definition and precision targeting
- **Seasonal and Temporal Audience Adaptation:** Time-based audience behavior and dynamic targeting adjustments
- **Competitive Audience Acquisition:** Competitor audience targeting and market share capture strategies

### 8. AUDIENCE GROWTH & EXPANSION ROADMAP
#### Strategic Audience Development Implementation Plan:

##### Short-Term Audience Optimization (30-90 days):
- **Immediate Audience Overlap Assessment:** Quick competitive audience analysis and opportunity identification
- **High-Converting Audience Segment Focus:** Priority audience targeting and acquisition cost optimization
- **Platform-Specific Audience Strategy:** Channel-optimized targeting and engagement improvement tactics
- **Content-Audience Alignment Enhancement:** Audience preference content optimization and engagement improvement
- **Tracking and Analytics Implementation:** Audience behavior monitoring and performance measurement setup

##### Medium-Term Audience Strategy (3-12 months):
- **Comprehensive Audience Persona Development:** Detailed customer profile creation and targeting precision enhancement
- **Cross-Platform Audience Journey Mapping:** Multi-channel audience experience optimization and conversion improvement
- **Audience Acquisition Campaign Development:** Systematic audience growth campaigns and expansion strategies
- **Retention and Loyalty Program Integration:** Audience lifecycle management and long-term relationship building
- **Competitive Audience Intelligence System:** Ongoing competitor audience monitoring and strategic response development

##### Long-Term Audience Vision (1-3 years):
- **Market-Leading Audience Position:** Industry-dominant audience capture and market share leadership
- **Emerging Platform Audience Development:** Next-generation platform early adoption and audience pioneering
- **Global Audience Expansion Strategy:** International market audience development and cultural adaptation
- **AI-Driven Audience Optimization:** Machine learning audience targeting and predictive audience modeling
- **Audience Innovation and Trendsetting:** Industry-leading audience strategies and targeting methodology development

## AUDIENCE RESEARCH EXCELLENCE STANDARDS

### Data-Driven Analysis Rigor:
- Base all recommendations on quantitative audience data and behavioral pattern analysis
- Provide specific audience targeting strategies with demographic and psychographic detail
- Ensure recommendations align with customer acquisition cost optimization and lifetime value maximization
- Validate audience suggestions against engagement rates and conversion performance metrics

### Strategic Audience Implementation Focus:
- Prioritize audience optimizations by acquisition potential and targeting precision opportunities
- Provide clear audience development timelines and resource allocation strategies
- Include audience measurement frameworks and continuous optimization methodologies
- Ensure scalability and sustainability of recommended audience targeting approaches

### Professional Audience Documentation:
- Structure analysis with clear audience strategy sections and actionable targeting subsections
- Use industry-standard audience research terminology and evaluation methodologies
- Provide specific audience examples, targeting parameters, and campaign frameworks
- Maintain focus on customer acquisition optimization and competitive audience advantage development

Generate the comprehensive audience overlap analysis now, ensuring it provides actionable strategic value for audience targeting optimization and competitive audience acquisition advantage.`;
}

function generate306090Prompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  // Calculate 30, 60, and 90 day target dates
  const date30 = new Date();
  date30.setDate(date30.getDate() + 30);
  const date60 = new Date();
  date60.setDate(date60.getDate() + 60);
  const date90 = new Date();
  date90.setDate(date90.getDate() + 90);
  
  return `# STRATEGIC 30-60-90 DAY BUSINESS ACCELERATION PLAN

## PLANNING DATE & TIMELINE CONTEXT
**Plan Start Date:** ${currentDate}
**30-Day Milestone Target:** ${date30.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**60-Day Milestone Target:** ${date60.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**90-Day Final Goal Date:** ${date90.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

**CRITICAL:** All timelines, milestones, and deliverables must be realistic and achievable within these specific date ranges. Consider current market conditions, seasonal factors, and business cycles.

## BUSINESS STRATEGY CONSULTANT PROFILE
You are a senior business strategy consultant with 10+ years of experience in organizational transformation, rapid business growth implementation, and strategic planning execution. You have led 90-day business acceleration programs for Fortune 500 companies, managed startup scaling initiatives, and specialize in goal-oriented planning, performance optimization, and measurable business impact delivery within compressed timeframes.

## STRATEGIC ACCELERATION MISSION
Develop a comprehensive 30-60-90 day strategic action plan to drive immediate business impact, establish competitive advantages, and create sustainable growth momentum. This plan will provide clear, actionable objectives with measurable outcomes to accelerate business performance and market positioning within the critical first 90 days.

## TARGET COMPANY PROFILE
### Primary Business Entity: ${company.NAME}
- **Industry Sector:** ${company.INDUSTRY || 'Industry not specified'}
- **Digital Infrastructure:** ${company.WEBSITE || 'Website not provided'}
- **Current Market Presence:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not tracked'} community members
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not tracked'} visual followers
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} professional connections
  * Customer Feedback Volume: ${company.GOOGLE_REVIEW_COUNT || 'Not tracked'} reviews and testimonials
  
### COMPETITIVE LANDSCAPE CONTEXT
${(competitors && competitors.length > 0) ? `
#### Market Competition Analysis:
${competitors.map((competitor, index) => `
**Competitor ${index + 1}: ${competitor.NAME}**
- Industry Position: ${competitor.INDUSTRY || 'Not specified'}
- Social Media Presence: ${competitor.FB_FOLLOWER_COUNT || 'N/A'} FB | ${competitor.INSTA_FOLLOWER_COUNT || 'N/A'} IG | ${competitor.LINKEDIN_FOLLOWER_COUNT || 'N/A'} LI
  - Market Validation: ${competitor.GOOGLE_REVIEW_COUNT || 'N/A'} reviews | ${competitor.SNAPCHAT_FOLLOWER_COUNT || 'N/A'} Snapchat
`).join('')}` : `
#### Competitive Analysis Scope:
Limited competitive data available. Plan will focus on general market best practices and industry-standard growth strategies.
`}

## COMPREHENSIVE 30-60-90 DAY STRATEGIC FRAMEWORK

### 1. EXECUTIVE STRATEGIC OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current business position assessment and immediate optimization opportunities
- Critical success factors for 90-day acceleration and competitive advantage development
- Expected business impact outcomes and strategic momentum building objectives

### 2. FIRST 30 DAYS: FOUNDATION & IMMEDIATE WINS
#### Sprint 1: Business Foundation Optimization (Days 1-30)

##### Week 1-2: Strategic Assessment & Quick Wins
**Immediate Priority Actions:**
- **Digital Presence Audit:** Comprehensive website, social media, and online reputation assessment
- **Competitive Intelligence Gathering:** Direct competitor analysis and market positioning evaluation
- **Customer Feedback Analysis:** Review mining, testimonial collection, and satisfaction assessment
- **Team Capability Assessment:** Staff skills evaluation and resource allocation optimization
- **Technology Stack Evaluation:** Current tools assessment and efficiency improvement identification

**Quick Win Implementations:**
- **Social Media Optimization:** Profile updates, content calendar initiation, and engagement improvement
- **Website Performance Enhancement:** Speed optimization, mobile responsiveness, and SEO basics
- **Customer Service Excellence:** Response time improvement and feedback system implementation
- **Content Creation Acceleration:** Blog post schedule, social content pipeline, and visual asset development
- **Analytics Implementation:** Tracking setup, KPI definition, and baseline measurement establishment

##### Week 3-4: Process Optimization & System Enhancement
**Operational Excellence Initiatives:**
- **Workflow Automation:** Process streamlining, task automation, and efficiency improvement implementation
- **Customer Onboarding Optimization:** New customer experience enhancement and retention improvement
- **Sales Process Refinement:** Lead qualification, conversion optimization, and pipeline management
- **Marketing Campaign Launch:** Immediate marketing initiatives and lead generation activation
- **Financial Tracking Enhancement:** Budget monitoring, expense optimization, and revenue tracking improvement

**Measurement & Tracking Setup:**
- **KPI Dashboard Creation:** Real-time business metrics monitoring and performance visualization
- **Customer Feedback Systems:** Review collection automation and satisfaction tracking implementation
- **Competitive Monitoring Setup:** Competitor tracking tools and market intelligence gathering systems
- **Team Performance Metrics:** Individual and team productivity measurement and optimization
- **ROI Tracking Implementation:** Marketing spend effectiveness and business impact measurement

### 3. SECOND 30 DAYS: GROWTH ACCELERATION (Days 31-60)
#### Sprint 2: Market Expansion & Revenue Growth

##### Week 5-6: Market Penetration & Customer Acquisition
**Growth Strategy Implementation:**
- **Target Audience Expansion:** New customer segment identification and targeting strategy development
- **Content Marketing Acceleration:** Blog content, video creation, and thought leadership establishment
- **Social Media Advertising:** Paid campaign launch, audience targeting, and conversion optimization
- **Partnership Development:** Strategic alliance exploration and collaboration opportunity assessment
- **Customer Referral Program:** Word-of-mouth marketing system and incentive program implementation

**Sales & Marketing Integration:**
- **Lead Generation Optimization:** Multiple channel lead capture and qualification improvement
- **Email Marketing Campaign:** Newsletter development, automation sequences, and nurture campaign creation
- **SEO Enhancement Initiative:** Keyword optimization, content strategy, and search ranking improvement
- **Customer Success Program:** Retention strategy implementation and loyalty program development
- **Competitive Differentiation:** Unique value proposition refinement and market positioning enhancement

##### Week 7-8: Operational Scaling & System Enhancement
**Business Process Optimization:**
- **Team Expansion Planning:** Hiring strategy, role definition, and organizational structure optimization
- **Technology Upgrade Implementation:** System improvements, integration enhancement, and efficiency tools
- **Customer Experience Enhancement:** Service quality improvement and touchpoint optimization
- **Financial Management Optimization:** Cash flow improvement, pricing strategy review, and cost optimization
- **Quality Assurance Implementation:** Service standards establishment and consistency improvement

**Performance Optimization Focus:**
- **Data-Driven Decision Making:** Analytics interpretation, insights generation, and strategy adjustment
- **Customer Lifetime Value Enhancement:** Retention improvement and revenue per customer optimization
- **Market Share Growth Strategy:** Competitive advantage leveraging and market position strengthening
- **Brand Recognition Building:** Brand awareness campaigns and reputation management enhancement
- **Innovation Pipeline Development:** Product/service improvement and future opportunity identification

### 4. THIRD 30 DAYS: MARKET LEADERSHIP (Days 61-90)
#### Sprint 3: Competitive Advantage & Sustainable Growth

##### Week 9-10: Market Leadership Establishment
**Industry Authority Building:**
- **Thought Leadership Development:** Industry expertise demonstration and market authority establishment
- **Strategic Partnership Execution:** Alliance implementation and collaborative growth initiative launch
- **Advanced Marketing Strategy:** Sophisticated campaign development and multi-channel optimization
- **Customer Community Building:** Brand advocacy development and community engagement enhancement
- **Innovation Implementation:** Competitive advantage features and service differentiation deployment

**Market Dominance Strategy:**
- **Competitive Response Development:** Market position defense and competitive advantage maintenance
- **Geographic Expansion Planning:** New market entry strategy and territorial growth planning
- **Product/Service Enhancement:** Offering optimization and value proposition strengthening
- **Premium Positioning Strategy:** Market leadership positioning and pricing optimization
- **Industry Recognition Pursuit:** Award applications, media coverage, and industry acknowledgment

##### Week 11-12: Long-Term Growth Foundation
**Sustainable Growth Infrastructure:**
- **Organizational Development:** Team structure optimization and leadership development planning
- **Strategic Planning Extension:** 6-month and annual strategic plan development and goal setting
- **Market Intelligence System:** Ongoing competitive monitoring and market trend analysis capabilities
- **Customer Success Optimization:** Long-term relationship building and retention excellence
- **Financial Performance Optimization:** Profitability improvement and sustainable growth economics

**Legacy & Momentum Building:**
- **Knowledge Management System:** Best practice documentation and process standardization
- **Succession Planning:** Leadership development and organizational resilience building
- **Market Expansion Roadmap:** Future growth opportunity identification and strategic planning
- **Innovation Culture Development:** Continuous improvement mindset and creative problem-solving
- **Stakeholder Relationship Excellence:** Investor, partner, and community relationship optimization

### 5. SUCCESS METRICS & PERFORMANCE MEASUREMENT
#### Comprehensive KPI Framework & Tracking System

##### 30-Day Success Metrics (Foundation Phase):
- **Digital Presence Improvement:** Website traffic increase, social media engagement growth, online review improvement
- **Operational Efficiency Gains:** Process automation implementation, response time reduction, task completion optimization
- **Team Performance Enhancement:** Productivity improvement, skill development progress, collaboration effectiveness
- **Customer Satisfaction Improvement:** Review score increase, complaint reduction, feedback quality enhancement
- **Financial Performance Baseline:** Revenue tracking, expense optimization, profitability assessment

##### 60-Day Success Metrics (Growth Phase):
- **Market Penetration Growth:** New customer acquisition, market share increase, competitive positioning improvement
- **Revenue Growth Achievement:** Sales increase, customer lifetime value improvement, pricing optimization success
- **Brand Recognition Enhancement:** Brand awareness measurement, reputation improvement, industry recognition progress
- **Operational Scaling Success:** Team expansion effectiveness, system scalability, process optimization achievement
- **Customer Loyalty Development:** Retention rate improvement, referral generation, advocacy program success

##### 90-Day Success Metrics (Leadership Phase):
- **Market Leadership Indicators:** Industry authority establishment, competitive advantage maintenance, thought leadership recognition
- **Sustainable Growth Achievement:** Long-term growth trajectory, scalable system implementation, organizational resilience
- **Innovation Implementation Success:** Competitive differentiation, value proposition enhancement, market positioning strength
- **Financial Performance Excellence:** Profitability optimization, cash flow improvement, investment return achievement
- **Strategic Goal Accomplishment:** Overall business transformation, stakeholder satisfaction, future growth preparation

### 6. RISK MANAGEMENT & CONTINGENCY PLANNING
#### Strategic Risk Assessment & Mitigation Framework

##### Implementation Risk Identification:
- **Resource Constraint Management:** Budget limitations, time constraints, and capability gaps mitigation
- **Market Volatility Response:** Economic changes, industry disruption, and competitive threat management
- **Team Performance Risk:** Skill gaps, capacity limitations, and execution challenge mitigation
- **Technology Implementation Risk:** System failures, integration challenges, and technical debt management
- **Customer Satisfaction Risk:** Service quality maintenance, expectation management, and relationship preservation

##### Contingency Strategy Development:
- **Alternative Strategy Options:** Backup plans, pivot strategies, and adaptation mechanisms
- **Resource Reallocation Plans:** Budget flexibility, team reassignment, and priority adjustment capabilities
- **Timeline Adjustment Protocols:** Milestone flexibility, deadline management, and progress optimization
- **Quality Assurance Maintenance:** Standard preservation, consistency assurance, and excellence maintenance
- **Stakeholder Communication Plans:** Transparency maintenance, expectation management, and relationship preservation

## STRATEGIC EXECUTION EXCELLENCE STANDARDS

### Implementation Rigor Requirements:
- Base all action items on measurable business outcomes and specific deliverable definitions
- Provide clear timeline specifications with milestone checkpoints and progress measurement criteria
- Ensure resource allocation aligns with business priorities and available capability constraints
- Validate all strategic initiatives against competitive advantage development and market positioning goals

### Performance Optimization Focus:
- Prioritize actions by business impact potential and implementation feasibility assessment
- Provide specific success metrics and measurement methodologies for all strategic initiatives
- Include risk mitigation strategies and contingency planning for critical business functions
- Ensure scalability and sustainability of all implemented systems and processes

### Professional Strategic Documentation:
- Structure plan with clear phase divisions and actionable milestone definitions
- Use industry-standard business terminology and strategic planning methodologies
- Provide specific implementation guides, timeline specifications, and resource allocation frameworks
- Maintain focus on measurable business impact and competitive advantage development

Generate the comprehensive 30-60-90 day strategic action plan now, ensuring it provides actionable strategic value for rapid business acceleration and sustainable competitive advantage development.`;
}

function generateRevenueModelCanvasPrompt(company, competitors) {
  const { currentDate, dateNote } = getCurrentDateContext();
  
  return `# COMPREHENSIVE REVENUE MODEL CANVAS & MONETIZATION STRATEGY

## REVENUE STRATEGY DATE & MARKET CONTEXT
${dateNote}
**Revenue Context:** All monetization strategies, pricing models, and revenue projections must reflect current market conditions and realistic business growth timelines as of this date.

## REVENUE STRATEGY CONSULTANT PROFILE
You are a senior revenue strategy consultant with 10+ years of experience in business model innovation, monetization optimization, and revenue stream diversification. You have designed revenue models for Fortune 500 companies, led fintech and SaaS pricing strategies, and specialize in subscription economics, marketplace revenue models, and multi-sided platform monetization frameworks.

## REVENUE MODEL DEVELOPMENT MISSION
Create a comprehensive Revenue Model Canvas to identify, optimize, and diversify revenue streams while establishing sustainable competitive advantages. This analysis will provide a systematic framework for revenue generation, pricing strategy optimization, and long-term financial sustainability across multiple business scenarios and market conditions.

## TARGET BUSINESS PROFILE
### Primary Revenue Entity: ${company.NAME}
- **Industry Sector:** ${company.INDUSTRY || 'Industry not specified'}
- **Digital Infrastructure:** ${company.WEBSITE || 'Website not provided'}
- **Market Engagement Indicators:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not tracked'} potential customers
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not tracked'} visual audience
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} B2B prospects
  * Customer Testimonials: ${company.GOOGLE_REVIEW_COUNT || 'Not tracked'} validation signals

### COMPETITIVE REVENUE LANDSCAPE
${(competitors && competitors.length > 0) ? `
#### Market Revenue Intelligence:
${competitors.map((competitor, index) => `
**Revenue Competitor ${index + 1}: ${competitor.NAME}**
- Industry Positioning: ${competitor.INDUSTRY || 'Not specified'}
- Market Presence Indicators: Revenue benchmarking reference for competitive analysis
`).join('')}` : `
#### Revenue Analysis Scope:
Limited competitive revenue data available. Model will focus on industry best practices and innovative monetization strategies.
`}

## COMPREHENSIVE REVENUE MODEL CANVAS FRAMEWORK

### 1. EXECUTIVE REVENUE STRATEGY OVERVIEW
Provide a strategic 3-paragraph executive summary covering:
- Current revenue model assessment and monetization opportunity analysis
- Critical revenue stream optimization and diversification potential
- Strategic revenue growth trajectory and financial sustainability roadmap

### 2. CORE REVENUE STREAMS IDENTIFICATION
#### Primary Revenue Generation Mechanisms

##### Direct Revenue Streams:
- **Product Sales Revenue:** Physical goods, digital products, and intellectual property monetization
- **Service Revenue:** Professional services, consulting, and expertise-based income generation
- **Subscription Revenue:** Recurring payment models, membership programs, and ongoing service access
- **Licensing Revenue:** Brand licensing, technology licensing, and intellectual property monetization
- **Franchise Revenue:** Business model replication, territory licensing, and brand expansion income

##### Transaction-Based Revenue:
- **Commission Revenue:** Marketplace transactions, affiliate programs, and referral-based income
- **Processing Fees:** Payment processing, transaction facilitation, and financial service charges
- **Platform Revenue:** Multi-sided marketplace commissions, listing fees, and success-based payments
- **Advertising Revenue:** Sponsored content, display advertising, and promotional partnership income
- **Data Monetization:** Information products, analytics services, and customer insights commercialization

### 3. CUSTOMER SEGMENT REVENUE OPTIMIZATION
#### Multi-Segment Monetization Strategy

##### B2C Customer Revenue Models:
- **Individual Consumer Pricing:** Personal use pricing, household subscriptions, and individual service packages
- **Premium Customer Tiers:** High-value customer segments, luxury offerings, and exclusive access programs
- **Volume Customer Strategies:** Bulk purchasing incentives, family plans, and group subscription models
- **Freemium Conversion Models:** Free-to-paid conversion, trial-to-subscription, and feature-based upselling
- **Loyalty Program Revenue:** Retention-based pricing, membership benefits, and exclusive access monetization

##### B2B Enterprise Revenue Strategies:
- **Enterprise Software Licensing:** Corporate subscriptions, user-based pricing, and organizational access fees
- **Professional Services Revenue:** Consulting income, implementation services, and ongoing support contracts
- **Training and Certification Revenue:** Educational programs, skill development, and professional certification income
- **Custom Solution Development:** Bespoke service offerings, specialized implementations, and unique requirement fulfillment
- **Strategic Partnership Revenue:** Joint ventures, co-marketing agreements, and collaborative revenue sharing

### 4. PRICING STRATEGY & VALUE PROPOSITION ALIGNMENT
#### Revenue Optimization Through Strategic Pricing

##### Value-Based Pricing Models:
- **Outcome-Based Pricing:** Results-driven pricing, performance incentives, and success-based fee structures
- **Usage-Based Pricing:** Consumption-driven costs, metered billing, and scalable pricing frameworks
- **Tiered Pricing Strategy:** Service level differentiation, feature-based pricing, and upgrade pathway creation
- **Dynamic Pricing Models:** Market-responsive pricing, demand-based adjustments, and real-time optimization
- **Bundle Pricing Strategy:** Package deals, cross-product discounts, and comprehensive solution pricing

##### Competitive Pricing Intelligence:
- **Market Positioning Pricing:** Premium, economy, and value-based market positioning strategies
- **Competitive Response Pricing:** Price matching, undercutting strategies, and differentiation-based premium pricing
- **Customer Acquisition Pricing:** Penetration pricing, introductory offers, and market entry strategies
- **Customer Lifetime Value Optimization:** Long-term relationship pricing, loyalty discounts, and retention incentives
- **Geographic Pricing Strategy:** Regional market adaptation, currency considerations, and local market optimization

### 5. REVENUE STREAM DIVERSIFICATION STRATEGY
#### Multi-Channel Revenue Generation

##### Digital Revenue Channels:
- **E-commerce Revenue:** Online sales, digital marketplace presence, and direct-to-consumer channels
- **SaaS Revenue Models:** Software subscriptions, cloud services, and digital platform access fees
- **Content Monetization:** Digital content sales, streaming revenue, and intellectual property licensing
- **Mobile App Revenue:** App sales, in-app purchases, and mobile-first monetization strategies
- **API Revenue Generation:** Developer ecosystem monetization, integration fees, and technology access pricing

##### Physical Revenue Channels:
- **Retail Partnership Revenue:** Wholesale distribution, retail markup, and channel partner agreements
- **Direct Sales Revenue:** Personal selling, trade shows, and direct customer engagement income
- **Franchise and Licensing:** Business model replication, territory expansion, and brand extension revenue
- **Equipment and Hardware Sales:** Physical product sales, installation services, and maintenance contracts
- **Real Estate and Location Revenue:** Property rental, venue services, and location-based income generation

### 6. CUSTOMER LIFETIME VALUE & RETENTION REVENUE
#### Long-Term Revenue Relationship Management

##### Customer Retention Revenue Strategy:
- **Subscription Renewal Optimization:** Retention rate improvement, churn reduction, and renewal incentive programs
- **Upselling and Cross-Selling Revenue:** Additional service sales, product expansion, and relationship deepening
- **Referral Revenue Programs:** Customer advocacy monetization, word-of-mouth incentives, and network effect leveraging
- **Customer Success Revenue:** Ongoing support services, premium assistance, and relationship management income
- **Community Revenue Generation:** Membership programs, exclusive access, and community-driven monetization

##### Customer Acquisition Cost vs. Lifetime Value:
- **CAC Optimization Strategy:** Acquisition cost reduction, channel efficiency improvement, and conversion rate optimization
- **LTV Enhancement Programs:** Customer value maximization, relationship extension, and revenue per customer growth
- **Payback Period Optimization:** Investment recovery acceleration, early monetization, and cash flow improvement
- **Retention Investment Strategy:** Customer success investment, satisfaction improvement, and loyalty program development
- **Advocacy Revenue Generation:** Customer testimonials, case studies, and referral program monetization

### 7. EMERGING REVENUE OPPORTUNITIES & INNOVATION
#### Next-Generation Monetization Strategies

##### Technology-Enabled Revenue Models:
- **AI and Automation Revenue:** Intelligent service offerings, automated solutions, and technology-enhanced value delivery
- **Blockchain and Cryptocurrency Revenue:** Digital asset services, tokenization opportunities, and decentralized monetization
- **IoT and Connected Device Revenue:** Smart device services, data collection monetization, and connected ecosystem revenue
- **Virtual and Augmented Reality Revenue:** Immersive experience monetization, virtual service delivery, and spatial computing revenue
- **Marketplace and Platform Revenue:** Multi-sided market creation, network effect monetization, and ecosystem orchestration

##### Sustainability and Social Impact Revenue:
- **ESG Revenue Opportunities:** Sustainable business practices, environmental service monetization, and social impact revenue
- **Carbon Credit and Offset Revenue:** Environmental service commercialization, sustainability consulting, and green technology monetization
- **Social Enterprise Revenue:** Purpose-driven monetization, community benefit services, and social impact measurement
- **Circular Economy Revenue:** Waste reduction services, resource optimization, and sustainability consulting income
- **Impact Investment Revenue:** Social return monetization, purpose-driven funding, and sustainable business model development

### 8. FINANCIAL MODELING & REVENUE FORECASTING
#### Revenue Model Financial Framework

##### Revenue Projection and Modeling:
- **Annual Recurring Revenue (ARR) Modeling:** Subscription revenue projection, growth rate forecasting, and renewal rate optimization
- **Monthly Recurring Revenue (MRR) Tracking:** Short-term revenue monitoring, growth trend analysis, and performance measurement
- **Revenue Run Rate Analysis:** Current performance extrapolation, growth trajectory modeling, and scaling projection
- **Seasonal Revenue Modeling:** Cyclical business pattern analysis, seasonal adjustment strategies, and timing optimization
- **Scenario Planning and Sensitivity Analysis:** Multiple revenue scenarios, risk assessment, and contingency planning

##### Profitability and Margin Analysis:
- **Gross Margin Optimization:** Cost of goods sold management, pricing strategy refinement, and profitability improvement
- **Operating Margin Enhancement:** Operational efficiency improvement, cost structure optimization, and scale economy leveraging
- **Contribution Margin Analysis:** Customer segment profitability, product line analysis, and resource allocation optimization
- **Unit Economics Modeling:** Per-customer profitability, service delivery cost analysis, and scalability assessment
- **Break-Even Analysis:** Profitability threshold identification, investment recovery planning, and growth milestone setting

## REVENUE MODEL EXCELLENCE STANDARDS

### Financial Analysis Rigor:
- Base all revenue projections on realistic market assumptions and competitive benchmarking data
- Provide specific financial modeling with revenue calculations, growth projections, and profitability analysis
- Ensure revenue strategies align with customer value delivery and market positioning objectives
- Validate revenue models against industry standards and competitive performance benchmarks

### Strategic Revenue Implementation Focus:
- Prioritize revenue opportunities by implementation feasibility and revenue impact potential
- Provide clear revenue generation timelines with milestone checkpoints and performance measurement
- Include risk mitigation strategies for revenue volatility and market uncertainty management
- Ensure scalability and sustainability of all proposed revenue generation mechanisms

### Professional Revenue Documentation:
- Structure canvas with clear revenue stream definitions and financial projection frameworks
- Use industry-standard financial terminology and revenue modeling methodologies
- Provide specific implementation guides, pricing strategies, and customer acquisition frameworks
- Maintain focus on sustainable revenue growth and competitive financial advantage development

Generate the comprehensive Revenue Model Canvas now, ensuring it provides actionable strategic value for revenue optimization and sustainable financial growth achievement.`;
}

function generateChurnFixPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `# COMPREHENSIVE CUSTOMER CHURN PREVENTION & RETENTION STRATEGY

## RETENTION STRATEGY DATE & URGENCY CONTEXT
**Analysis Date:** ${currentDate}
**Retention Urgency:** All churn prevention strategies, customer outreach timelines, and retention program implementations must consider immediate customer risk factors and be executable within realistic timeframes as of this date.

## CUSTOMER SUCCESS SPECIALIST PROFILE
You are a senior customer success strategist with 10+ years of experience in churn reduction, customer retention optimization, and loyalty program development. You have led customer success initiatives for Fortune 500 SaaS companies, managed enterprise retention programs, and specialize in predictive churn analytics, customer lifecycle management, and proactive retention strategy implementation.

## CHURN PREVENTION MISSION
Develop a comprehensive churn prevention strategy to identify at-risk customers, implement proactive retention measures, and optimize customer lifetime value through systematic churn reduction. This analysis will provide actionable frameworks to minimize customer attrition, enhance satisfaction, and build sustainable customer loyalty programs.

## TARGET RETENTION PROFILE
### Primary Company: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Industry not specified'}
- **Customer Engagement Signals:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not tracked'} community engagement
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not tracked'} brand interaction
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} B2B relationships
  * Customer Feedback Volume: ${company.GOOGLE_REVIEW_COUNT || 'Not tracked'} satisfaction indicators

### COMPETITIVE RETENTION LANDSCAPE
${(competitors && competitors.length > 0) ? `
#### Market Retention Benchmarks:
${competitors.map((competitor, index) => `
**Retention Competitor ${index + 1}: ${competitor.NAME}**
- Social Engagement: FB:${competitor.FB_FOLLOWER_COUNT || 'N/A'} IG:${competitor.INSTA_FOLLOWER_COUNT || 'N/A'} LI:${competitor.LINKEDIN_FOLLOWER_COUNT || 'N/A'}
- Customer Satisfaction: ${competitor.GOOGLE_REVIEW_COUNT || 'N/A'} reviews
`).join('')}` : `
#### Retention Analysis Scope:
Limited competitive retention data available. Strategy will focus on industry best practices and proven churn reduction methodologies.
`}

## COMPREHENSIVE CHURN PREVENTION FRAMEWORK

### 1. EXECUTIVE RETENTION STRATEGY OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Current customer retention challenges and churn risk assessment
- Critical retention opportunities and customer success optimization potential
- Strategic churn prevention roadmap and expected customer lifetime value impact

### 2. CHURN RISK IDENTIFICATION & EARLY WARNING SYSTEM
#### Predictive Churn Analytics Framework

##### Customer Behavior Warning Signals:
- **Engagement Decline Indicators:** Login frequency reduction, feature usage decrease, support ticket increase
- **Usage Pattern Changes:** Service utilization drops, feature abandonment, subscription downgrades
- **Communication Response Reduction:** Email open rate decline, survey non-participation, feedback absence
- **Payment and Billing Issues:** Late payments, payment failures, pricing complaints, contract renegotiation requests
- **Support Interaction Patterns:** Increased complaint frequency, escalation trends, satisfaction score decline

##### Customer Health Score Development:
- **Engagement Metrics:** Platform usage frequency, feature adoption rate, session duration analysis
- **Satisfaction Indicators:** NPS scores, CSAT ratings, review sentiment, feedback quality assessment
- **Business Value Realization:** ROI achievement, goal completion rate, success milestone tracking
- **Relationship Quality Metrics:** Account team interaction, executive engagement, partnership development
- **Financial Health Indicators:** Payment history, contract renewal probability, expansion opportunity assessment

### 3. PROACTIVE RETENTION INTERVENTION STRATEGY
#### Multi-Touch Customer Success Framework

##### Early Intervention Programs:
- **Onboarding Optimization:** New customer success acceleration, early value demonstration, expectation setting
- **Regular Health Check System:** Quarterly business reviews, success milestone tracking, goal alignment verification
- **Educational Content Program:** Best practice sharing, training resources, skill development support
- **Community Engagement Enhancement:** User group participation, peer networking, success story sharing
- **Executive Sponsor Program:** C-level relationship building, strategic partnership development, long-term vision alignment

##### Customer Success Automation:
- **Trigger-Based Outreach:** Automated engagement based on usage patterns, behavior changes, milestone achievements
- **Personalized Communication:** Customized messaging, relevant content delivery, individual success plan updates
- **Success Milestone Recognition:** Achievement celebration, progress acknowledgment, goal completion rewards
- **Predictive Intervention:** AI-driven risk assessment, proactive outreach, preventive problem-solving
- **Escalation Management:** Risk tier identification, specialized intervention, executive engagement protocols

### 4. CUSTOMER EXPERIENCE OPTIMIZATION
#### Friction Reduction and Satisfaction Enhancement

##### Service Quality Improvement:
- **Response Time Optimization:** Support ticket resolution acceleration, first-contact resolution improvement
- **Self-Service Enhancement:** Knowledge base expansion, FAQ optimization, video tutorial development
- **Product Usability Improvement:** Interface simplification, workflow optimization, feature accessibility enhancement
- **Performance and Reliability:** System uptime improvement, speed optimization, error reduction initiatives
- **Integration and Compatibility:** Third-party integration enhancement, API reliability, ecosystem connectivity

##### Communication Excellence:
- **Proactive Communication:** Regular updates, maintenance notifications, feature announcements, success tips
- **Feedback Loop Optimization:** Survey automation, sentiment monitoring, continuous improvement implementation
- **Transparency Enhancement:** Service status communication, roadmap sharing, honest problem acknowledgment
- **Personalization Strategy:** Individual communication preferences, customized content delivery, relationship personalization
- **Multi-Channel Support:** Phone, email, chat, video support options, preferred communication method accommodation

### 5. VALUE DEMONSTRATION & BENEFIT REINFORCEMENT
#### Continuous Value Delivery Framework

##### ROI and Value Communication:
- **Success Metrics Tracking:** KPI achievement demonstration, business impact measurement, value quantification
- **Case Study Development:** Customer success story creation, peer comparison, industry benchmark communication
- **Regular Business Review:** Quarterly value assessment, goal progress review, future opportunity identification
- **Competitive Advantage Demonstration:** Market positioning benefits, unique value proposition reinforcement
- **Future Roadmap Alignment:** Innovation preview, upcoming feature benefits, long-term partnership vision

##### Upselling and Expansion Strategy:
- **Natural Growth Opportunities:** Usage-based expansion, team growth accommodation, feature upgrade benefits
- **Success-Based Expansion:** Achievement-driven upselling, performance-based recommendations, goal-aligned growth
- **Ecosystem Integration:** Additional service offerings, complementary product recommendations, comprehensive solution development
- **Strategic Partnership Development:** Long-term contract benefits, preferred customer status, exclusive access opportunities
- **Innovation Early Access:** Beta feature participation, product development influence, cutting-edge technology access

### 6. LOYALTY PROGRAM & RETENTION INCENTIVES
#### Customer Loyalty Enhancement Strategy

##### Retention Incentive Programs:
- **Loyalty Rewards System:** Long-term customer benefits, tenure-based advantages, exclusive access programs
- **Renewal Incentives:** Contract extension benefits, early renewal discounts, multi-year commitment rewards
- **Referral Reward Programs:** Customer advocacy incentives, word-of-mouth benefits, network expansion rewards
- **Exclusive Customer Benefits:** VIP treatment, priority support, special event access, premium service levels
- **Achievement Recognition:** Success celebration, milestone rewards, industry recognition support

##### Community Building and Advocacy:
- **Customer Advisory Board:** Product development influence, strategic input opportunities, executive access
- **User Community Platform:** Peer networking, knowledge sharing, best practice exchange, collaborative problem-solving
- **Success Story Participation:** Case study development, conference speaking, industry recognition opportunities
- **Beta Testing Programs:** Early feature access, product development influence, innovation partnership
- **Industry Leadership Positioning:** Thought leadership support, market authority building, expertise recognition

### 7. CHURN RECOVERY & WIN-BACK STRATEGY
#### Customer Recovery and Re-engagement Framework

##### At-Risk Customer Intervention:
- **Executive Escalation Protocol:** C-level engagement, strategic relationship rescue, partnership preservation
- **Service Recovery Program:** Problem resolution acceleration, compensation consideration, relationship repair
- **Contract Renegotiation:** Pricing adjustment, service modification, terms optimization, value alignment
- **Transition Support:** Migration assistance, change management, disruption minimization, continuity assurance
- **Alternative Solution Development:** Custom configuration, specialized service, unique requirement accommodation

##### Win-Back Campaign Strategy:
- **Former Customer Re-engagement:** Improvement communication, new feature benefits, enhanced value proposition
- **Competitive Displacement:** Superior value demonstration, switching incentives, migration support
- **Market Re-entry Opportunities:** Business change accommodation, new requirement fulfillment, evolving need satisfaction
- **Relationship Rebuilding:** Trust restoration, credibility reestablishment, partnership renewal
- **Success Guarantee Programs:** Risk mitigation, performance assurance, satisfaction commitment

### 8. RETENTION MEASUREMENT & OPTIMIZATION
#### Churn Prevention Performance Framework

##### Retention Metrics and KPIs:
- **Churn Rate Analysis:** Monthly/annual churn tracking, cohort analysis, trend identification
- **Customer Lifetime Value (CLV):** Long-term relationship value, retention ROI measurement
- **Net Revenue Retention:** Expansion revenue tracking, upselling success, customer growth measurement
- **Customer Satisfaction Scores:** NPS, CSAT, customer effort score tracking
- **Retention Campaign Effectiveness:** Intervention success rates, program ROI, improvement measurement

##### Continuous Improvement Strategy:
- **Churn Root Cause Analysis:** Exit interview insights, cancellation reason tracking, improvement opportunity identification
- **Retention Strategy Optimization:** Program effectiveness review, best practice identification, strategy refinement
- **Competitive Retention Benchmarking:** Industry comparison, best practice adoption, performance gap closure
- **Team Performance Optimization:** Customer success team training, skill development, performance improvement
- **Technology and Tool Enhancement:** Retention platform optimization, automation improvement, analytics advancement

## CUSTOMER RETENTION EXCELLENCE STANDARDS

### Data-Driven Retention Analysis:
- Base all strategies on customer behavior data and churn pattern analysis
- Provide specific retention tactics with implementation timelines and success metrics
- Ensure recommendations align with customer lifetime value optimization and satisfaction improvement
- Validate retention approaches against industry benchmarks and competitive performance standards

### Proactive Retention Implementation:
- Prioritize retention initiatives by churn risk impact and implementation feasibility
- Provide clear customer success frameworks with measurement and optimization guidelines
- Include automation strategies and scalable retention system development
- Ensure sustainability and continuous improvement of retention program effectiveness

### Professional Retention Documentation:
- Structure strategy with clear retention phases and actionable intervention frameworks
- Use customer success industry terminology and proven retention methodologies
- Provide specific implementation guides, communication templates, and success measurement frameworks
- Maintain focus on customer lifetime value optimization and competitive retention advantage

Generate the comprehensive churn prevention strategy now, ensuring it provides actionable value for customer retention optimization and sustainable business growth.`;
}

function generateKPIDashboardBlueprintPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `# COMPREHENSIVE KPI DASHBOARD BLUEPRINT & BUSINESS INTELLIGENCE FRAMEWORK

## DASHBOARD DEVELOPMENT DATE & CONTEXT
**Blueprint Creation Date:** ${currentDate}
**Implementation Reality:** All KPI metrics, reporting frequencies, and dashboard deployment timelines must be realistic and achievable with current technology and business processes as of this date.

## BUSINESS ANALYTICS SPECIALIST PROFILE
You are a senior business intelligence consultant with 10+ years of experience in KPI dashboard design, data visualization optimization, and executive reporting systems. You have implemented dashboard solutions for Fortune 500 companies, managed enterprise analytics platforms, and specialize in performance measurement frameworks, real-time business monitoring, and data-driven decision support systems.

## KPI DASHBOARD DEVELOPMENT MISSION
Design a comprehensive KPI dashboard blueprint to provide real-time business performance visibility, enable data-driven decision making, and optimize operational efficiency through strategic metric monitoring. This blueprint will establish a systematic framework for performance tracking, goal achievement monitoring, and competitive positioning assessment.

## TARGET BUSINESS PROFILE
### Primary Dashboard Entity: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Industry not specified'}
- **Current Performance Indicators:**
  * Facebook Community Engagement: ${company.FB_FOLLOWER_COUNT || 'Not tracked'} followers
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not tracked'} audience
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not tracked'} connections
  * Customer Satisfaction Signals: ${company.GOOGLE_REVIEW_COUNT || 'Not tracked'} reviews

### COMPETITIVE PERFORMANCE CONTEXT
${(competitors && competitors.length > 0) ? `
#### Market Performance Benchmarks:
${competitors.map((competitor, index) => `
**Benchmark Entity ${index + 1}: ${competitor.NAME}**
- Performance Comparison: FB:${competitor.FB_FOLLOWER_COUNT || 'N/A'} IG:${competitor.INSTA_FOLLOWER_COUNT || 'N/A'} LI:${competitor.LINKEDIN_FOLLOWER_COUNT || 'N/A'} Reviews:${competitor.GOOGLE_REVIEW_COUNT || 'N/A'}
`).join('')}` : `
#### Dashboard Design Scope:
Limited competitive benchmark data available. Dashboard will focus on industry best practices and comprehensive performance measurement frameworks.
`}

## COMPREHENSIVE KPI DASHBOARD FRAMEWORK

### 1. EXECUTIVE DASHBOARD STRATEGY OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Current business performance visibility gaps and dashboard optimization opportunities
- Critical KPI measurement priorities and real-time monitoring requirements
- Strategic dashboard implementation roadmap and expected business intelligence impact

### 2. EXECUTIVE-LEVEL KPI DASHBOARD
#### C-Suite Performance Visibility Framework

##### Financial Performance Metrics:
- **Revenue Tracking:** Monthly recurring revenue (MRR), annual recurring revenue (ARR), revenue growth rate, revenue per customer
- **Profitability Analysis:** Gross margin, operating margin, EBITDA, profit margin trends, cost structure optimization
- **Cash Flow Management:** Operating cash flow, free cash flow, cash burn rate, runway analysis, working capital management
- **Investment Performance:** Return on investment (ROI), return on assets (ROA), return on equity (ROE), capital efficiency metrics
- **Financial Health Indicators:** Debt-to-equity ratio, current ratio, quick ratio, financial stability assessment

##### Strategic Business Metrics:
- **Market Position:** Market share percentage, competitive positioning index, brand recognition metrics, industry ranking
- **Customer Metrics:** Customer acquisition cost (CAC), customer lifetime value (CLV), customer satisfaction score (CSAT), Net Promoter Score (NPS)
- **Growth Indicators:** User growth rate, market expansion progress, new market penetration, product adoption metrics
- **Operational Efficiency:** Productivity metrics, resource utilization, process efficiency, automation success rates
- **Innovation Metrics:** R&D investment percentage, new product revenue, innovation pipeline strength, time-to-market performance

### 3. OPERATIONAL PERFORMANCE DASHBOARD
#### Department-Specific KPI Monitoring

##### Sales Performance Metrics:
- **Revenue Generation:** Sales quota achievement, deal closure rate, average deal size, sales cycle length
- **Pipeline Management:** Lead conversion rate, opportunity win rate, pipeline velocity, forecast accuracy
- **Sales Team Performance:** Individual quota attainment, activity metrics, territory performance, commission tracking
- **Customer Acquisition:** New customer count, acquisition cost per channel, source attribution, conversion funnel performance
- **Sales Efficiency:** Sales productivity, cost per acquisition, revenue per salesperson, sales tool utilization

##### Marketing Performance Metrics:
- **Campaign Effectiveness:** Campaign ROI, cost per lead, lead quality score, attribution analysis
- **Digital Marketing:** Website traffic, conversion rates, email marketing metrics, social media engagement
- **Brand Awareness:** Brand mention tracking, share of voice, sentiment analysis, brand recall metrics
- **Content Performance:** Content engagement, download rates, video views, blog traffic, SEO performance
- **Marketing Qualified Leads (MQLs):** Lead scoring, nurturing effectiveness, sales-ready lead conversion

### 4. CUSTOMER SUCCESS & SATISFACTION DASHBOARD
#### Customer-Centric Performance Monitoring

##### Customer Health Metrics:
- **Satisfaction Measurement:** CSAT scores, NPS tracking, customer effort score (CES), retention rate analysis
- **Usage Analytics:** Product adoption rate, feature utilization, session frequency, user engagement depth
- **Support Performance:** Ticket resolution time, first-contact resolution rate, support satisfaction, escalation frequency
- **Customer Success:** Onboarding completion rate, time-to-value, goal achievement, success milestone tracking
- **Churn Prevention:** Churn rate, at-risk customer identification, retention campaign effectiveness, win-back success

##### Customer Lifecycle Analytics:
- **Acquisition Journey:** Awareness-to-trial conversion, trial-to-paid conversion, onboarding completion rate
- **Engagement Progression:** Feature adoption timeline, usage growth patterns, engagement score development
- **Retention Analysis:** Cohort retention curves, subscription renewal rates, downgrade/upgrade patterns
- **Expansion Opportunities:** Upselling success rate, cross-selling effectiveness, account growth metrics
- **Advocacy Development:** Referral generation, testimonial participation, case study collaboration

### 5. OPERATIONAL EFFICIENCY DASHBOARD
#### Process Optimization & Resource Management

##### Resource Utilization Metrics:
- **Team Productivity:** Employee utilization rates, project completion times, efficiency benchmarks, capacity planning
- **Technology Performance:** System uptime, response times, error rates, automation success, tool adoption
- **Process Efficiency:** Workflow completion times, bottleneck identification, process improvement tracking
- **Quality Metrics:** Error rates, rework frequency, customer complaint resolution, quality score trends
- **Cost Management:** Cost per unit, operational expense ratios, vendor management, budget variance analysis

##### Performance Optimization Indicators:
- **Automation Impact:** Manual task reduction, process automation ROI, efficiency gain measurement
- **Continuous Improvement:** Process enhancement projects, optimization initiative success, innovation implementation
- **Compliance and Risk:** Regulatory compliance rates, risk mitigation effectiveness, audit performance
- **Vendor Performance:** Supplier scorecards, SLA compliance, vendor relationship quality, cost effectiveness
- **Infrastructure Metrics:** Capacity utilization, scalability readiness, technology debt management

### 6. COMPETITIVE INTELLIGENCE DASHBOARD
#### Market Position & Competitive Analysis

##### Competitive Performance Tracking:
- **Market Share Analysis:** Relative market position, share growth/decline, competitive positioning trends
- **Feature Comparison:** Product feature parity, competitive advantage areas, innovation gap analysis
- **Pricing Intelligence:** Competitive pricing analysis, market price positioning, value proposition comparison
- **Customer Migration:** Customer acquisition from competitors, churn to competitors, switching pattern analysis
- **Brand Comparison:** Brand sentiment vs. competitors, awareness comparison, reputation analysis

##### Industry Benchmark Metrics:
- **Performance Benchmarking:** Industry average comparison, best-in-class benchmarks, performance gap analysis
- **Trend Analysis:** Industry growth trends, emerging technology adoption, market evolution tracking
- **Opportunity Identification:** Market white space analysis, unaddressed customer needs, expansion opportunities
- **Threat Assessment:** Competitive threat monitoring, market disruption risk, emerging competitor tracking
- **Strategic Positioning:** Unique value proposition strength, differentiation effectiveness, market niche dominance

### 7. REAL-TIME ALERT & NOTIFICATION SYSTEM
#### Proactive Performance Monitoring

##### Critical Alert Thresholds:
- **Performance Degradation:** Revenue decline alerts, churn rate spikes, customer satisfaction drops
- **Opportunity Alerts:** High-value lead notifications, upselling opportunities, expansion possibilities
- **Risk Indicators:** Budget variance warnings, compliance issues, system performance problems
- **Competitive Intelligence:** Competitor pricing changes, new product launches, market disruption signals
- **Goal Achievement:** Milestone completion, target attainment, performance breakthrough notifications

##### Automated Reporting System:
- **Executive Summary Reports:** Weekly C-suite dashboards, monthly board reports, quarterly business reviews
- **Department Performance Reports:** Team-specific metrics, individual performance tracking, goal progress updates
- **Customer Health Reports:** Account health assessments, at-risk customer identification, success story highlights
- **Financial Performance Reports:** Revenue analysis, profitability tracking, budget variance reporting
- **Market Intelligence Reports:** Competitive landscape updates, industry trend analysis, opportunity assessments

### 8. DASHBOARD IMPLEMENTATION & OPTIMIZATION
#### Technical Architecture & User Experience

##### Dashboard Design Principles:
- **User Experience Optimization:** Intuitive navigation, responsive design, mobile accessibility, personalization options
- **Data Visualization Best Practices:** Clear chart selection, color consistency, interactive elements, drill-down capabilities
- **Performance Requirements:** Fast loading times, real-time updates, scalable architecture, reliable data connections
- **Security and Access Control:** Role-based permissions, data privacy compliance, secure authentication, audit trails
- **Integration Capabilities:** Multi-system data consolidation, API connectivity, third-party tool integration

##### Continuous Improvement Framework:
- **User Feedback Integration:** Dashboard usability testing, user satisfaction surveys, feature request tracking
- **Performance Optimization:** Loading speed improvement, data accuracy enhancement, visualization refinement
- **Metric Evolution:** KPI relevance review, new metric introduction, outdated indicator removal
- **Technology Upgrades:** Platform enhancement, tool integration improvement, capability expansion
- **Training and Adoption:** User education programs, best practice sharing, dashboard utilization optimization

## KPI DASHBOARD EXCELLENCE STANDARDS

### Data Accuracy and Reliability:
- Base all metrics on verified data sources with real-time accuracy and consistency validation
- Provide specific KPI definitions with calculation methodologies and data source documentation
- Ensure dashboard performance aligns with business objectives and strategic goal achievement
- Validate all metrics against industry benchmarks and competitive performance standards

### Strategic Business Alignment:
- Prioritize KPIs by business impact relevance and decision-making importance
- Provide clear metric interpretation guidelines with actionable insight generation
- Include predictive analytics and trend forecasting capabilities for proactive decision making
- Ensure scalability and adaptability of dashboard framework for business growth and evolution

### Professional Dashboard Documentation:
- Structure blueprint with clear metric categories and visualization specifications
- Use industry-standard analytics terminology and dashboard design best practices
- Provide specific implementation guides, technical requirements, and user training frameworks
- Maintain focus on actionable business intelligence and competitive performance optimization

Generate the comprehensive KPI dashboard blueprint now, ensuring it provides actionable strategic value for data-driven decision making and business performance optimization.`;
}

function generateGTMPlanPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  // Calculate GTM milestone dates
  const launchDate = new Date();
  launchDate.setDate(launchDate.getDate() + 90); // 3 months
  const phase1Date = new Date();
  phase1Date.setDate(phase1Date.getDate() + 30); // 1 month
  const phase2Date = new Date();
  phase2Date.setDate(phase2Date.getDate() + 60); // 2 months
  
  return `# COMPREHENSIVE GO-TO-MARKET STRATEGY & LAUNCH EXECUTION PLAN

## GTM TIMELINE & LAUNCH CONTEXT
**Strategy Development Date:** ${currentDate}
**Phase 1 Target (Preparation):** ${phase1Date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Phase 2 Target (Pre-Launch):** ${phase2Date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Target Launch Date:** ${launchDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

**TIMING CONSIDERATIONS:** All launch timelines, market entry strategies, and campaign schedules must account for current market conditions, seasonal business cycles, and realistic execution capabilities as of this date.

## GO-TO-MARKET STRATEGIST PROFILE
You are a senior go-to-market consultant with 10+ years of experience in product launch strategy, market entry planning, and revenue acceleration programs. You have led successful GTM initiatives for Fortune 500 companies, managed multi-million dollar product launches, and specialize in customer acquisition strategy, sales enablement, and market penetration optimization across B2B and B2C markets.

## GO-TO-MARKET MISSION
Develop a comprehensive go-to-market strategy to accelerate customer acquisition, optimize market penetration, and establish competitive positioning for sustainable revenue growth. This plan will provide systematic frameworks for target market identification, customer acquisition optimization, and scalable revenue generation across multiple channels and customer segments.

## TARGET MARKET ENTITY
### Primary Company: ${company.NAME}
- **Industry Sector:** ${company.INDUSTRY || 'Industry not specified'}
- **Current Market Presence:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not established'} potential customers
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not established'} audience reach
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not established'} B2B connections
  * Customer Validation: ${company.GOOGLE_REVIEW_COUNT || 'Not established'} market feedback

### COMPETITIVE MARKET LANDSCAPE
${(competitors && competitors.length > 0) ? `
#### Market Competition Analysis:
${competitors.map((competitor, index) => `
**Market Player ${index + 1}: ${competitor.NAME}**
- Industry Position: ${competitor.INDUSTRY || 'Not specified'}
- Competitive Reference: Market entry and positioning benchmark
`).join('')}` : `
#### Market Analysis Scope:
Limited competitive intelligence available. Strategy will focus on market opportunity identification and best practice GTM methodologies.
`}

## COMPREHENSIVE GO-TO-MARKET FRAMEWORK

### 1. EXECUTIVE GTM STRATEGY OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Target market opportunity assessment and customer acquisition potential
- Critical GTM success factors and competitive differentiation strategy
- Expected market penetration timeline and revenue generation projections

### 2. MARKET OPPORTUNITY & TARGET CUSTOMER ANALYSIS
#### Strategic Market Segmentation Framework

##### Primary Target Market Definition:
- **Total Addressable Market (TAM):** Complete market size, industry scope, geographic boundaries, maximum revenue potential
- **Serviceable Addressable Market (SAM):** Realistic market segment, competitive landscape, accessible customer base
- **Serviceable Obtainable Market (SOM):** Achievable market share, realistic penetration goals, initial target customer volume
- **Market Timing Analysis:** Market readiness, economic conditions, competitive landscape maturity, adoption trend timing
- **Growth Opportunity Assessment:** Market expansion potential, emerging segment identification, future opportunity pipeline

##### Ideal Customer Profile (ICP) Development:
- **B2B Customer Characteristics:** Company size, industry vertical, revenue range, technology adoption, decision-making structure
- **B2C Customer Demographics:** Age, income, lifestyle, technology usage, purchasing behavior, brand preferences
- **Pain Point Analysis:** Unmet needs, current solution limitations, frustration areas, improvement desires
- **Buying Behavior Patterns:** Decision-making process, purchase triggers, evaluation criteria, budget allocation, timeline expectations
- **Value Perception Mapping:** Benefit prioritization, price sensitivity, feature importance, service expectation levels

### 3. COMPETITIVE POSITIONING & DIFFERENTIATION STRATEGY
#### Market Positioning Framework

##### Unique Value Proposition Development:
- **Core Differentiation:** Unique features, competitive advantages, proprietary capabilities, exclusive benefits
- **Value Proposition Canvas:** Customer jobs-to-be-done, pain relievers, gain creators, value delivery mechanism
- **Competitive Advantage Sustainability:** Defensible moats, barrier creation, competitive response mitigation
- **Brand Positioning Statement:** Clear market position, target customer definition, unique benefit articulation
- **Messaging Framework:** Value communication, benefit emphasis, differentiation highlighting, emotional connection building

##### Competitive Response Strategy:
- **Direct Competitor Analysis:** Feature comparison, pricing analysis, market positioning assessment, strength/weakness evaluation
- **Indirect Competitor Monitoring:** Alternative solution tracking, substitute product analysis, emerging threat assessment
- **Competitive Intelligence System:** Market monitoring, competitor tracking, strategic response planning, advantage maintenance
- **Blue Ocean Strategy:** Uncontested market space identification, new demand creation, competition irrelevance achievement
- **Defensive Strategy Development:** Market position protection, customer retention, competitive advantage preservation

### 4. CUSTOMER ACQUISITION STRATEGY & CHANNEL OPTIMIZATION
#### Multi-Channel Customer Acquisition Framework

##### Digital Marketing & Lead Generation:
- **Content Marketing Strategy:** Educational content, thought leadership, SEO optimization, inbound lead generation
- **Social Media Marketing:** Platform-specific strategies, community building, engagement optimization, viral growth tactics
- **Paid Advertising Strategy:** PPC campaigns, social media ads, display advertising, retargeting optimization
- **Email Marketing Automation:** Lead nurturing sequences, customer onboarding, retention campaigns, lifecycle marketing
- **Search Engine Optimization:** Organic visibility, keyword strategy, content optimization, local search enhancement

##### Sales Channel Development:
- **Direct Sales Strategy:** Inside sales, field sales, enterprise sales, consultative selling approach
- **Partner Channel Program:** Reseller networks, affiliate programs, strategic partnerships, channel enablement
- **Online Sales Optimization:** E-commerce platform, conversion optimization, user experience enhancement, checkout optimization
- **Retail Partnership Strategy:** Distribution agreements, retail placement, merchandising optimization, point-of-sale support
- **Channel Conflict Management:** Territory management, pricing consistency, partner relationship optimization

### 5. SALES ENABLEMENT & PROCESS OPTIMIZATION
#### Revenue Generation Acceleration Framework

##### Sales Team Development:
- **Sales Training Program:** Product knowledge, competitive positioning, objection handling, closing techniques
- **Sales Collateral Development:** Pitch decks, case studies, ROI calculators, competitive battle cards
- **CRM Implementation:** Lead management, pipeline tracking, activity automation, performance analytics
- **Sales Process Optimization:** Lead qualification, opportunity management, deal progression, forecasting accuracy
- **Performance Management:** Quota setting, commission structure, performance tracking, coaching programs

##### Customer Success Integration:
- **Onboarding Process Design:** New customer welcome, product training, early value demonstration, success milestone tracking
- **Customer Success Metrics:** Adoption rates, satisfaction scores, renewal rates, expansion opportunities
- **Support System Development:** Help desk, knowledge base, community forums, self-service resources
- **Feedback Loop Creation:** Customer input collection, product improvement, service enhancement, satisfaction optimization
- **Advocacy Program Development:** Reference customers, case study participants, testimonial generation, referral incentives

### 6. PRICING STRATEGY & REVENUE MODEL OPTIMIZATION
#### Strategic Pricing Framework

##### Pricing Model Selection:
- **Value-Based Pricing:** Customer value alignment, ROI justification, outcome-based pricing, success fee structures
- **Competitive Pricing Strategy:** Market positioning, price benchmarking, competitive response planning, differentiation justification
- **Freemium and Trial Strategy:** Free tier design, conversion optimization, upgrade pathway creation, value demonstration
- **Subscription Pricing:** Recurring revenue optimization, tier design, usage-based pricing, upgrade incentives
- **Dynamic Pricing Implementation:** Market-responsive pricing, demand-based adjustment, customer segment optimization

##### Revenue Stream Diversification:
- **Primary Revenue Sources:** Core product sales, subscription revenue, service income, licensing fees
- **Secondary Revenue Opportunities:** Add-on services, consulting revenue, training income, partnership fees
- **Recurring Revenue Development:** Subscription conversion, renewal optimization, expansion revenue, loyalty programs
- **Marketplace Revenue:** Platform fees, transaction revenue, listing charges, advertising income
- **Data Monetization:** Information products, analytics services, market insights, trend reporting

### 7. LAUNCH STRATEGY & EXECUTION ROADMAP
#### Market Entry Timeline Framework

##### Pre-Launch Phase (60-90 days):
- **Market Research Completion:** Customer validation, competitive analysis, pricing research, demand assessment
- **Product Readiness:** Feature completion, quality assurance, documentation creation, support preparation
- **Team Preparation:** Sales training, marketing preparation, customer success readiness, partner enablement
- **Marketing Asset Creation:** Website development, content creation, collateral design, campaign preparation
- **Channel Partner Recruitment:** Partner identification, agreement negotiation, enablement program development

##### Launch Phase (30-60 days):
- **Marketing Campaign Launch:** Multi-channel campaign activation, PR outreach, industry announcement, thought leadership
- **Sales Team Activation:** Lead generation initiation, customer outreach, demo scheduling, pipeline building
- **Partner Channel Activation:** Reseller training, partner campaign launch, co-marketing initiation, channel support
- **Customer Onboarding System:** Process activation, training delivery, success tracking, feedback collection
- **Performance Monitoring:** Metric tracking, campaign optimization, process refinement, issue resolution

##### Post-Launch Optimization (90+ days):
- **Performance Analysis:** Campaign effectiveness, conversion rate analysis, customer feedback assessment, competitive response
- **Strategy Refinement:** Message optimization, targeting adjustment, channel reallocation, process improvement
- **Scale Preparation:** Resource planning, team expansion, system enhancement, capacity building
- **Market Expansion:** Geographic expansion, segment extension, product line expansion, partnership development
- **Long-term Strategy Development:** Market leadership planning, innovation roadmap, competitive advantage building

### 8. SUCCESS METRICS & PERFORMANCE OPTIMIZATION
#### GTM Performance Measurement Framework

##### Customer Acquisition Metrics:
- **Lead Generation:** Lead volume, lead quality, cost per lead, conversion rates, source attribution
- **Sales Performance:** Pipeline velocity, win rates, average deal size, sales cycle length, quota attainment
- **Customer Metrics:** Customer acquisition cost (CAC), customer lifetime value (CLV), payback period, retention rates
- **Channel Performance:** Channel effectiveness, partner contribution, cost per acquisition by channel, ROI analysis
- **Market Penetration:** Market share growth, competitive displacement, brand awareness, customer adoption

##### Revenue and Growth Metrics:
- **Revenue Tracking:** Monthly recurring revenue (MRR), annual recurring revenue (ARR), revenue growth rate, expansion revenue
- **Profitability Analysis:** Gross margin, contribution margin, unit economics, break-even analysis, cash flow positive timeline
- **Market Position:** Competitive ranking, market share percentage, brand recognition, customer satisfaction benchmarks
- **Operational Efficiency:** Cost structure optimization, process efficiency, resource utilization, automation success
- **Strategic Goal Achievement:** Market penetration targets, revenue milestones, customer acquisition goals, competitive positioning

## GO-TO-MARKET EXCELLENCE STANDARDS

### Market-Driven Strategy Development:
- Base all recommendations on comprehensive market research and customer validation data
- Provide specific implementation timelines with resource requirements and success milestones
- Ensure strategies align with competitive positioning and sustainable competitive advantage development
- Validate approaches against industry benchmarks and proven GTM methodologies

### Execution-Focused Implementation:
- Prioritize activities by market impact potential and implementation feasibility assessment
- Provide clear operational frameworks with measurement and optimization guidelines
- Include risk mitigation strategies and contingency planning for market entry challenges
- Ensure scalability and adaptability of GTM processes for business growth and market evolution

### Professional GTM Documentation:
- Structure plan with clear phase definitions and actionable implementation frameworks
- Use industry-standard go-to-market terminology and proven strategic methodologies
- Provide specific execution guides, timeline specifications, and resource allocation frameworks
- Maintain focus on measurable market success and sustainable revenue growth achievement

Generate the comprehensive go-to-market strategy now, ensuring it provides actionable strategic value for successful market entry and accelerated customer acquisition.`;
}

function generateValuePropositionPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `# STRATEGIC VALUE PROPOSITION DESIGN & COMPETITIVE DIFFERENTIATION

## VALUE STRATEGY DATE & MARKET CONTEXT
**Strategy Development Date:** ${currentDate}
**Market Positioning Reality:** All value propositions, competitive messaging, and market positioning strategies must reflect current market conditions, customer expectations, and competitive landscape as of this date.

## VALUE PROPOSITION STRATEGIST PROFILE
You are a senior value proposition consultant with 10+ years of experience in brand positioning, customer value optimization, and competitive differentiation strategy. You have crafted value propositions for Fortune 500 companies, led market positioning initiatives across multiple industries, and specialize in customer-centric value articulation, benefit communication optimization, and competitive advantage messaging frameworks.

## VALUE PROPOSITION DEVELOPMENT MISSION
Create a compelling, differentiated value proposition that clearly articulates unique customer benefits, establishes competitive advantages, and drives customer acquisition through persuasive value communication. This analysis will provide a systematic framework for value definition, benefit articulation, and competitive positioning that resonates with target customers and drives business growth.

## TARGET VALUE ENTITY
### Primary Company: ${company.NAME}
- **Industry Context:** ${company.INDUSTRY || 'Industry not specified'}
- **Digital Presence:** ${company.WEBSITE || 'Website not provided'}
- **Market Engagement Indicators:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not established'} brand advocates
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not established'} visual audience
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not established'} B2B relationships
  * Customer Validation: ${company.GOOGLE_REVIEW_COUNT || 'Not established'} testimonials

### COMPETITIVE VALUE LANDSCAPE
${(competitors && competitors.length > 0) ? `
#### Value Proposition Competitive Context:
${competitors.map((competitor, index) => `
**Value Competitor ${index + 1}: ${competitor.NAME}**
- Competitive positioning reference for differentiation analysis
`).join('')}` : `
#### Value Analysis Scope:
Limited competitive value data available. Proposition will focus on customer-centric value creation and industry best practice differentiation strategies.
`}

## COMPREHENSIVE VALUE PROPOSITION FRAMEWORK

### 1. EXECUTIVE VALUE STRATEGY OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Current market value landscape and customer benefit opportunity assessment
- Critical value differentiation potential and competitive positioning advantages
- Strategic value communication roadmap and expected customer acquisition impact

### 2. CUSTOMER-CENTRIC VALUE DISCOVERY
#### Deep Customer Needs Analysis Framework

##### Customer Jobs-to-be-Done Identification:
- **Functional Jobs:** Core tasks customers need to accomplish, operational requirements, performance objectives
- **Emotional Jobs:** Feelings customers want to experience, security needs, status aspirations, confidence building
- **Social Jobs:** How customers want to be perceived, relationship enhancement, community belonging, professional positioning
- **Job Context Analysis:** Situation-specific needs, environmental factors, timing considerations, constraint analysis
- **Job Importance Hierarchy:** Priority ranking, urgency levels, frequency requirements, impact assessment

##### Pain Point and Frustration Analysis:
- **Current Solution Limitations:** Existing provider shortcomings, product gaps, service deficiencies, unmet expectations
- **Process Inefficiencies:** Time waste, complexity issues, unnecessary steps, friction points, bottleneck identification
- **Cost and Resource Drain:** Expensive alternatives, resource intensive solutions, hidden costs, inefficient spending
- **Risk and Security Concerns:** Reliability issues, safety problems, compliance challenges, trust deficits
- **Experience Frustrations:** Poor customer service, difficult interfaces, lack of personalization, communication gaps

### 3. UNIQUE VALUE CREATION & BENEFIT ARTICULATION
#### Core Value Proposition Development

##### Primary Value Drivers:
- **Functional Benefits:** Performance improvement, efficiency gains, cost reduction, time savings, quality enhancement
- **Economic Benefits:** Revenue increase, cost savings, ROI improvement, investment protection, financial optimization
- **Risk Reduction Benefits:** Security enhancement, compliance assurance, reliability improvement, peace of mind
- **Convenience Benefits:** Simplicity, ease of use, accessibility, automation, process streamlining
- **Status and Social Benefits:** Professional advancement, competitive advantage, industry recognition, prestige enhancement

##### Quantifiable Value Metrics:
- **Performance Improvement:** Speed increases, accuracy enhancement, productivity gains, efficiency metrics
- **Cost Impact Analysis:** Savings calculations, investment returns, total cost of ownership reduction
- **Time Value Creation:** Process acceleration, automation benefits, resource optimization, productivity multiplication
- **Quality Enhancement:** Error reduction, improvement percentages, satisfaction increases, performance benchmarks
- **Risk Mitigation Value:** Security improvements, compliance benefits, reliability enhancements, downtime reduction

### 4. COMPETITIVE DIFFERENTIATION STRATEGY
#### Unique Positioning Framework

##### Differentiation Dimensions:
- **Feature Differentiation:** Unique capabilities, proprietary technology, exclusive features, advanced functionality
- **Service Differentiation:** Superior support, personalized service, expert guidance, relationship quality
- **Experience Differentiation:** User interface excellence, customer journey optimization, interaction quality
- **Performance Differentiation:** Speed advantages, reliability superiority, accuracy improvements, efficiency gains
- **Value Differentiation:** Cost effectiveness, ROI superiority, total value optimization, investment justification

##### Competitive Advantage Sustainability:
- **Barrier Creation:** Switching costs, network effects, exclusive partnerships, proprietary assets
- **Innovation Leadership:** Continuous improvement, technology advancement, market trend anticipation
- **Customer Lock-in:** Integration depth, customization levels, relationship investment, success dependency
- **Brand Strength:** Reputation advantages, trust levels, market recognition, thought leadership position
- **Operational Excellence:** Cost structure advantages, process efficiency, quality systems, delivery optimization

### 5. VALUE PROPOSITION CANVAS DEVELOPMENT
#### Systematic Value Mapping Framework

##### Customer Profile Mapping:
- **Customer Segments:** Primary target groups, secondary audiences, stakeholder influence, decision maker identification
- **Customer Jobs:** Core objectives, supporting tasks, related activities, context considerations
- **Pain Points:** Obstacle identification, frustration sources, challenge areas, improvement opportunities
- **Gain Expectations:** Desired outcomes, benefit aspirations, success definitions, value expectations

##### Value Map Creation:
- **Products and Services:** Core offerings, supporting services, complementary products, ecosystem components
- **Pain Relievers:** Problem solutions, frustration elimination, obstacle removal, challenge mitigation
- **Gain Creators:** Benefit delivery, value generation, outcome achievement, expectation exceeding
- **Fit Assessment:** Value-customer alignment, need satisfaction, expectation fulfillment, problem resolution

### 6. VALUE COMMUNICATION STRATEGY
#### Message Development and Articulation Framework

##### Core Value Statement Development:
- **Primary Value Proposition:** Single, clear benefit statement, target customer identification, unique differentiation
- **Supporting Value Points:** Secondary benefits, proof points, feature advantages, service benefits
- **Proof and Evidence:** Customer testimonials, case studies, data validation, third-party verification
- **Credibility Building:** Company credentials, team expertise, industry recognition, certification validation
- **Call-to-Action Integration:** Next step clarity, engagement invitation, trial offers, consultation opportunities

##### Multi-Audience Value Messaging:
- **Decision Maker Messaging:** Executive benefits, strategic value, ROI justification, competitive advantage
- **End User Communication:** Daily benefits, ease of use, productivity improvements, experience enhancement
- **Technical Audience:** Feature details, integration capabilities, security features, performance specifications
- **Financial Stakeholder:** Cost benefits, investment returns, budget optimization, financial risk reduction
- **Industry-Specific Adaptation:** Vertical market customization, sector-specific benefits, regulatory compliance value

### 7. VALUE PROPOSITION TESTING & VALIDATION
#### Market Validation Framework

##### Customer Feedback and Validation:
- **Customer Interview Insights:** Direct feedback, preference validation, benefit confirmation, improvement suggestions
- **A/B Testing Strategy:** Message variation testing, response rate comparison, conversion optimization
- **Market Research Validation:** Survey results, focus group insights, preference studies, buying criteria analysis
- **Competitive Response Analysis:** Market reaction, competitor adjustments, positioning shifts, differentiation sustainability
- **Sales Team Feedback:** Field validation, objection patterns, win/loss analysis, message effectiveness assessment

##### Continuous Value Optimization:
- **Performance Measurement:** Conversion rates, engagement metrics, customer acquisition effectiveness, retention impact
- **Message Refinement:** Language optimization, benefit emphasis adjustment, proof point enhancement
- **Market Evolution Adaptation:** Trend alignment, changing customer needs, competitive landscape shifts
- **Customer Success Integration:** Outcome tracking, value realization measurement, satisfaction correlation
- **Innovation Integration:** New feature benefits, capability enhancements, value proposition evolution

### 8. VALUE PROPOSITION IMPLEMENTATION ROADMAP
#### Strategic Value Communication Deployment

##### Implementation Strategy:
- **Marketing Integration:** Website messaging, advertising campaigns, content strategy, social media alignment
- **Sales Enablement:** Pitch deck integration, objection handling, competitive positioning, value demonstration tools
- **Customer Success Alignment:** Onboarding messaging, success milestones, value realization tracking
- **Brand Consistency:** Visual identity alignment, tone of voice consistency, message coherence across touchpoints
- **Training and Education:** Team alignment, message training, value articulation skills, customer communication

##### Performance Optimization:
- **Metrics and Measurement:** Value proposition effectiveness, customer response rates, conversion improvements
- **Feedback Integration:** Customer insights, market response, competitive intelligence, continuous improvement
- **Market Expansion:** New segment adaptation, geographic customization, industry-specific value propositions
- **Innovation Alignment:** Product development integration, feature benefit articulation, value enhancement
- **Long-term Evolution:** Value proposition maturation, market leadership positioning, competitive advantage sustainability

## VALUE PROPOSITION EXCELLENCE STANDARDS

### Customer-Centric Value Focus:
- Base all value propositions on deep customer need understanding and validated benefit preferences
- Provide specific, measurable value claims with quantifiable benefit articulation
- Ensure value propositions align with target customer priorities and decision-making criteria
- Validate value claims against competitive alternatives and market positioning requirements

### Differentiation and Positioning Clarity:
- Prioritize unique benefits that create sustainable competitive advantages
- Provide clear competitive differentiation with specific advantage articulation
- Include proof points and evidence that support value proposition claims
- Ensure value communication resonates with target audience language and preferences

### Professional Value Documentation:
- Structure proposition with clear benefit hierarchy and supporting evidence
- Use customer-centric language with industry-appropriate terminology and validation
- Provide specific implementation guides, messaging frameworks, and communication strategies
- Maintain focus on customer acquisition optimization and competitive market positioning

Generate the comprehensive value proposition now, ensuring it provides compelling strategic value for customer acquisition and competitive differentiation success.`;
}

function generatePivotIdeasPrompt(company, competitors) {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `# STRATEGIC PIVOT & ADJACENT OPPORTUNITY INNOVATION FRAMEWORK

## PIVOT STRATEGY DATE & MARKET TIMING
**Pivot Analysis Date:** ${currentDate}
**Market Timing Critical:** All pivot recommendations, transformation timelines, and market entry strategies must consider current economic conditions, industry trends, and realistic execution timeframes as of this date.

## BUSINESS INNOVATION STRATEGIST PROFILE
You are a senior business innovation consultant with 10+ years of experience in corporate pivoting, adjacency strategy, and business model transformation. You have led pivot initiatives for Fortune 500 companies, managed startup transformation programs, and specialize in market opportunity identification, business model innovation, and strategic diversification across multiple industries and market conditions.

## PIVOT STRATEGY DEVELOPMENT MISSION
Identify and develop strategic pivot opportunities and adjacent business plays to expand market reach, diversify revenue streams, and create new competitive advantages. This analysis will provide systematic frameworks for business transformation, market expansion, and innovation-driven growth that leverages existing capabilities while exploring new market opportunities.

## TARGET TRANSFORMATION ENTITY
### Primary Company: ${company.NAME}
- **Current Industry Position:** ${company.INDUSTRY || 'Industry not specified'}
- **Digital Infrastructure:** ${company.WEBSITE || 'Website not provided'}
- **Market Foundation Assets:**
  * Facebook Community: ${company.FB_FOLLOWER_COUNT || 'Not established'} potential pivot audience
  * Instagram Visual Platform: ${company.INSTA_FOLLOWER_COUNT || 'Not established'} brand recognition
  * LinkedIn Professional Network: ${company.LINKEDIN_FOLLOWER_COUNT || 'Not established'} B2B relationships
  * Customer Trust Base: ${company.GOOGLE_REVIEW_COUNT || 'Not established'} reputation capital

### COMPETITIVE INNOVATION LANDSCAPE
${(competitors && competitors.length > 0) ? `
#### Market Innovation Context:
${competitors.map((competitor, index) => `
**Innovation Reference ${index + 1}: ${competitor.NAME}**
- Market position and potential pivot inspiration for differentiation analysis
`).join('')}` : `
#### Innovation Analysis Scope:
Limited competitive innovation data available. Pivot strategy will focus on market opportunity identification and innovative business model exploration.
`}

## COMPREHENSIVE PIVOT STRATEGY FRAMEWORK

### 1. EXECUTIVE INNOVATION OVERVIEW
Provide a strategic 3-paragraph summary covering:
- Current business model assessment and transformation opportunity analysis
- Critical pivot potential and adjacent market expansion possibilities
- Strategic innovation roadmap and expected business transformation impact

### 2. CORE ASSET & CAPABILITY AUDIT
#### Foundation Assessment for Pivot Strategy

##### Existing Asset Inventory:
- **Intellectual Property Assets:** Patents, trademarks, proprietary technology, trade secrets, content libraries
- **Customer Relationship Capital:** Database, loyalty, trust, testimonials, community engagement, brand recognition
- **Team Expertise and Knowledge:** Skills, experience, industry knowledge, relationships, credibility, thought leadership
- **Technology Infrastructure:** Platforms, systems, data, automation, integration capabilities, digital assets
- **Financial Resources:** Cash position, funding access, revenue streams, investment capacity, credit facilities

##### Transferable Capabilities Analysis:
- **Core Competencies:** Unique skills, competitive advantages, operational excellence, process mastery
- **Market Knowledge:** Industry insights, customer understanding, competitive intelligence, trend awareness
- **Operational Capabilities:** Supply chain, distribution, manufacturing, service delivery, quality systems
- **Brand and Reputation Strength:** Market recognition, trust levels, authority position, customer loyalty
- **Network and Partnership Access:** Industry connections, supplier relationships, distribution channels, strategic alliances

### 3. MARKET OPPORTUNITY IDENTIFICATION
#### Adjacent Market Exploration Framework

##### Horizontal Market Expansion:
- **Same Customer, Different Problems:** Addressing additional needs of existing customer base with new solutions
- **Same Industry, Different Segments:** Targeting different customer groups within current industry vertical
- **Technology Application Transfer:** Applying existing technology solutions to different industries or use cases
- **Skill Set Monetization:** Leveraging team expertise in consulting, training, or advisory services
- **Platform Extension:** Expanding current platform capabilities to serve additional market segments

##### Vertical Market Integration:
- **Supply Chain Integration:** Moving up or down the value chain to capture more value
- **Value Chain Extension:** Adding complementary services or products to existing customer journey
- **Distribution Channel Development:** Creating new channels or becoming a channel for other companies
- **Data Monetization:** Leveraging customer data and insights for new revenue streams
- **Ecosystem Orchestration:** Becoming a platform that connects multiple stakeholders and captures transaction value

### 4. BUSINESS MODEL INNOVATION OPPORTUNITIES
#### Transformation Strategy Development

##### Revenue Model Diversification:
- **Subscription Transformation:** Converting one-time sales to recurring revenue models
- **Platform Business Model:** Creating multi-sided markets and transaction-based revenue
- **As-a-Service Offerings:** Converting products to service-based delivery models
- **Marketplace Development:** Connecting buyers and sellers while capturing transaction fees
- **Freemium and Value Ladder:** Creating multiple price points and upgrade pathways

##### Operational Model Innovation:
- **Digital Transformation:** Online service delivery, automation, and virtual operations
- **Partnership and Outsourcing:** Leveraging external capabilities for rapid scaling
- **Asset-Light Models:** Reducing capital requirements through sharing economy approaches
- **Network Effects Business:** Creating value that increases with user base growth
- **Community-Driven Models:** Leveraging user-generated content and peer-to-peer value creation

### 5. TECHNOLOGY-ENABLED PIVOT OPPORTUNITIES
#### Digital Innovation and Emerging Technology Applications

##### AI and Automation Pivots:
- **Intelligent Service Delivery:** AI-powered automation of current services for efficiency and scalability
- **Predictive Analytics Services:** Data analysis and forecasting services for other businesses
- **Machine Learning Applications:** Custom AI solutions for specific industry problems
- **Chatbot and Virtual Assistant Services:** Automated customer service and support solutions
- **Process Optimization Consulting:** AI-driven business process improvement services

##### Digital Platform and SaaS Pivots:
- **Software as a Service Development:** Converting expertise into software solutions
- **API and Integration Services:** Becoming a connectivity provider for business ecosystems
- **Data Analytics Platforms:** Business intelligence and reporting services
- **Workflow Automation Tools:** Process management and productivity software
- **Industry-Specific Software Solutions:** Vertical market software development

### 6. MARKET TREND ALIGNMENT OPPORTUNITIES
#### Future-Focused Pivot Strategy

##### Sustainability and ESG Pivots:
- **Green Technology Solutions:** Environmental impact reduction and sustainability services
- **Carbon Footprint Management:** Tracking, reporting, and reduction consulting services
- **Circular Economy Services:** Waste reduction, recycling, and resource optimization
- **Social Impact Measurement:** ESG reporting and social responsibility consulting
- **Sustainable Supply Chain:** Green procurement and sustainable sourcing services

##### Health and Wellness Pivots:
- **Digital Health Solutions:** Telemedicine, health monitoring, and wellness platforms
- **Mental Health and Wellbeing:** Stress management, mindfulness, and mental health services
- **Fitness and Nutrition:** Personal health optimization and lifestyle improvement services
- **Elder Care and Accessibility:** Aging population services and accessibility solutions
- **Workplace Wellness:** Employee health and productivity improvement programs

### 7. STRATEGIC PIVOT IMPLEMENTATION ROADMAP
#### Transformation Execution Framework

##### Pivot Validation and Testing:
- **Market Research and Validation:** Customer interview, demand assessment, competitive analysis
- **Prototype Development:** Minimum viable product creation, proof of concept, pilot testing
- **Financial Modeling:** Revenue projections, investment requirements, break-even analysis
- **Risk Assessment:** Market risk, execution risk, cannibalization analysis, mitigation strategies
- **Resource Planning:** Team requirements, skill gaps, infrastructure needs, funding assessment

##### Pivot Execution Strategy:
- **Gradual Transition Approach:** Phased implementation, parallel operation, risk-managed transformation
- **Bold Pivot Strategy:** Complete business model transformation, rapid market entry, aggressive positioning
- **Portfolio Diversification:** Multiple adjacency exploration, diversified risk approach, option creation
- **Partnership-Driven Pivots:** Strategic alliances, joint ventures, acquisition integration
- **Innovation Lab Approach:** Separate innovation unit, experimental development, incubation strategy

### 8. FINANCIAL PLANNING & RESOURCE ALLOCATION
#### Pivot Investment Framework

##### Investment Requirements Analysis:
- **Development Costs:** Product development, technology investment, team building, infrastructure setup
- **Market Entry Expenses:** Marketing investment, customer acquisition, brand building, channel development
- **Operational Transition Costs:** Process changes, system integration, training, change management
- **Risk Mitigation Investment:** Contingency planning, insurance, diversification, safety nets
- **Growth Capital Requirements:** Scaling investment, expansion funding, working capital, inventory

##### Return on Investment Projections:
- **Revenue Diversification Benefits:** Risk reduction, growth acceleration, market expansion value
- **Competitive Advantage Creation:** Differentiation value, market positioning, barrier establishment
- **Asset Utilization Optimization:** Existing resource leverage, efficiency improvement, capacity maximization
- **Strategic Option Value:** Future opportunity creation, flexibility enhancement, adaptability improvement
- **Long-term Value Creation:** Sustainable competitive advantage, market leadership, enterprise value

## BUSINESS INNOVATION EXCELLENCE STANDARDS

### Market-Driven Innovation Focus:
- Base all pivot recommendations on validated market opportunities and customer need assessment
- Provide specific implementation strategies with realistic timelines and resource requirements
- Ensure pivot strategies align with core competency leverage and sustainable competitive advantage creation
- Validate innovation approaches against market trends and competitive landscape evolution

### Strategic Transformation Implementation:
- Prioritize pivot opportunities by market potential and execution feasibility assessment
- Provide clear transformation frameworks with risk mitigation and success measurement guidelines
- Include financial modeling and investment return projections for all pivot strategies
- Ensure scalability and sustainability of transformation initiatives and business model changes

### Professional Innovation Documentation:
- Structure analysis with clear innovation categories and actionable transformation frameworks
- Use strategic innovation terminology and proven business model transformation methodologies
- Provide specific implementation guides, financial projections, and resource allocation strategies
- Maintain focus on sustainable business transformation and competitive market positioning advantage

Generate the comprehensive pivot strategy analysis now, ensuring it provides actionable strategic value for business transformation and innovative growth opportunity development.`;
}

// Map report types to their prompt generators
const REPORT_HANDLERS = {
  "swot-analysis": generateSWOTPrompt,
  "competitor-analysis": generateCompetitorAnalysisPrompt,
  "market-share": generateMarketSharePrompt,
  "content-gap": generateContentGapPrompt,
  "technical-seo": generateTechnicalSEOPrompt,
  "ux-comparison": generateUXComparisonPrompt,
  "pricing-comparison": generatePricingComparisonPrompt,
  "brand-presence": generateBrandPresencePrompt,
  "audience-overlap": generateAudienceOverlapPrompt,
  "30-60-90": generate306090Prompt,
  "revenue-model-canvas": generateRevenueModelCanvasPrompt,
  "churn-fix": generateChurnFixPrompt,
  "kpi-dashboard-blueprint": generateKPIDashboardBlueprintPrompt,
  "go-to-market-plan": generateGTMPlanPrompt,
  "value-proposition": generateValuePropositionPrompt,
  "pivot-ideas": generatePivotIdeasPrompt,
};

// Function to save report to business books table
async function saveReportToBusinessBooks(companyId, reportType, reportContent, userid, firmid) {
  try {
    // Get company name for book title
    const company = await db.queryOne(
      'SELECT NAME FROM COMPA_COMPANIES WHERE COMPANY_ID = ?',
      [companyId]
    );
    
    const bookTitle = `${reportType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} - ${company?.NAME || 'Unknown Company'}`;
    
    await db.execute(
      `INSERT INTO BUSINESS_BOOKS (PROGRAMID, BOOK_TITLE, PERSONID, BOOK_TYPE, VENDOR_ID, BOOK_CONTENT)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         BOOK_CONTENT = VALUES(BOOK_CONTENT),
         RAG_DTM = CURRENT_TIMESTAMP`,
      [firmid, bookTitle, userid, reportType, companyId, reportContent]
    );
    console.log(`✅ Report ${reportType} saved to BUSINESS_BOOKS for company ${companyId}`);
  } catch (err) {
    console.error(`❌ Error saving ${reportType} report to BUSINESS_BOOKS:`, err);
  }
}

// Single endpoint to handle all report generation
const { getAllFollowers } = require('./utils/socialFollowers');
app.post("/api/generate-report/:reportType", async (req, res) => {
  const { reportType } = req.params;
  let { companyId, competitorIds = [], userid, firmid } = req.body || {};

  // Robust competitor ID processing
  if (typeof competitorIds === 'string') {
    competitorIds = competitorIds.split(',').map(id => id.trim()).filter(id => id);
  } else if (!Array.isArray(competitorIds)) {
    competitorIds = [];
  }
  // Convert to numbers and filter valid IDs
  competitorIds = competitorIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);

  // If no competitorIds provided, load latest saved preference for this company
  if (companyId && competitorIds.length === 0) {
    try {
      const prefRows = await db.query(
        `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
         WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
         ORDER BY PREF_ID DESC LIMIT 1`,
        [companyId]
      );
      if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
        try {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[ReportGeneration] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        } catch (e) {
          console.warn(`[ReportGeneration] Failed to parse saved COMPETITOR_IDS JSON:`, e?.message);
        }
      } else {
        console.log(`[ReportGeneration] No saved preferences found for company ${companyId}`);
      }
    } catch (e) {
      console.warn(`[ReportGeneration] Error loading saved preferences:`, e?.message);
    }
  }

  // Validate report type
  if (!REPORT_HANDLERS[reportType]) {
    return res.status(400).json({
      success: false,
      error: `Invalid report type. Must be one of: ${Object.keys(REPORT_HANDLERS).join(", ")}`,
    });
  }

  if (!companyId) {
    return res.status(400).json({
      success: false,
      error: "companyId is required.",
    });
  }

  try {
    console.log(`[ReportGeneration] Starting ${reportType} report for company ${companyId} with ${competitorIds.length} competitors`);
    
    // 1. Get company data (Google Review URLs and Region)
    const [company] = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
              sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT,
              COALESCE(kv.GOOGLE_RVW_LINK, sf.GOOGLE_REVIEW_URL) as GOGL_RVW_URL,
              COALESCE(kv.CITY, '') as CITY,
              COALESCE(kv.STATE, '') as STATE,
              COALESCE(kv.COUNTRY, '') as COUNTRY,
              CONCAT_WS(', ',
                NULLIF(kv.CITY, ''),
                IF(kv.STATE != kv.CITY, NULLIF(kv.STATE, ''), NULL),
                IF(kv.COUNTRY != kv.CITY AND kv.COUNTRY != kv.STATE, NULLIF(kv.COUNTRY, ''), NULL)
              ) as REGION
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       LEFT JOIN kf_vendor kv ON cc.COMPANY_ID = kv.VEND_ID
       WHERE cc.COMPANY_ID = ?
       LIMIT 1`,
      [companyId]
    );
    
    // 2. Get competitors data (Google Review URLs and Region)
    const competitors = competitorIds.length
      ? await db.query(
          `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
                  sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
                  sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT,
                  COALESCE(kv.GOOGLE_RVW_LINK, sf.GOOGLE_REVIEW_URL, comp.GOGL_RVW_URL) as GOGL_RVW_URL,
                  COALESCE(kv.CITY, '') as CITY,
                  COALESCE(kv.STATE, '') as STATE,
                  COALESCE(kv.COUNTRY, '') as COUNTRY,
                  CONCAT_WS(', ',
                    NULLIF(kv.CITY, ''),
                    IF(kv.STATE != kv.CITY, NULLIF(kv.STATE, ''), NULL),
                    IF(kv.COUNTRY != kv.CITY AND kv.COUNTRY != kv.STATE, NULLIF(kv.COUNTRY, ''), NULL)
                  ) as REGION
           FROM COMPA_COMPANIES cc
           LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPET_COMPANY_ID
           LEFT JOIN kf_vendor kv ON cc.COMPANY_ID = kv.VEND_ID
           LEFT JOIN COMPA_COMPETITORS comp ON cc.COMPANY_ID = comp.COMPET_COMPANY_ID
           WHERE cc.COMPANY_ID IN (${competitorIds.map(() => "?").join(",")})`,
          competitorIds
        )
      : [];

    // 3. Scrape Google Reviews FIRST (before social media scrapers)
    console.log(`[ReportGeneration] Scraping Google reviews...`);
    const allCompanies = [company, ...competitors];
    const reviewsData = await GoogleReviewsService.getReviewsForCompanies(allCompanies, userid, firmid);
    
    // Attach review data to company and competitors
    company.googleReviews = reviewsData[company.COMPANY_ID] || { averageRating: null, totalReviews: 0, topReviews: [] };
    competitors.forEach(comp => {
      comp.googleReviews = reviewsData[comp.COMPANY_ID] || { averageRating: null, totalReviews: 0, topReviews: [] };
    });
    
    console.log(`[ReportGeneration] Reviews collected - Company: ${company.googleReviews.totalReviews} reviews (${company.googleReviews.averageRating}★)`);
    competitors.forEach(comp => {
      console.log(`[ReportGeneration] - ${comp.NAME}: ${comp.googleReviews.totalReviews} reviews (${comp.googleReviews.averageRating}★)`);
    });

    // 4. Social media scraping DISABLED - using existing DB data only
    console.log(`[ReportGeneration] Social media scraping disabled - using existing database values`);
    // const scrapingResult = await followerService.ensureFollowerData(companyId, competitorIds);
    // if (scrapingResult.success) {
    //   console.log(`[ReportGeneration] Follower data updated: ${scrapingResult.summary.totalSuccess} succeeded, ${scrapingResult.summary.totalFailed} failed`);
    // } else {
    //   console.warn(`[ReportGeneration] Follower scraping had issues: ${scrapingResult.error}`);
    // }

    // 5. Refresh company and competitor data with updated follower counts
    const [updatedCompany] = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
              sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT,
              COALESCE(kv.GOOGLE_RVW_LINK, sf.GOOGLE_REVIEW_URL) as GOGL_RVW_URL,
              CONCAT_WS(', ',
                NULLIF(kv.CITY, ''),
                IF(kv.STATE != kv.CITY, NULLIF(kv.STATE, ''), NULL),
                IF(kv.COUNTRY != kv.CITY AND kv.COUNTRY != kv.STATE, NULLIF(kv.COUNTRY, ''), NULL)
              ) as REGION
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       LEFT JOIN kf_vendor kv ON cc.COMPANY_ID = kv.VEND_ID
       WHERE cc.COMPANY_ID = ?
       LIMIT 1`,
      [companyId]
    );
    
    const updatedCompetitors = competitorIds.length
      ? await db.query(
          `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
                  sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
                  sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT,
                  COALESCE(kv.GOOGLE_RVW_LINK, sf.GOOGLE_REVIEW_URL, comp.GOGL_RVW_URL) as GOGL_RVW_URL,
                  CONCAT_WS(', ',
                    NULLIF(kv.CITY, ''),
                    IF(kv.STATE != kv.CITY, NULLIF(kv.STATE, ''), NULL),
                    IF(kv.COUNTRY != kv.CITY AND kv.COUNTRY != kv.STATE, NULLIF(kv.COUNTRY, ''), NULL)
                  ) as REGION
           FROM COMPA_COMPANIES cc
           LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPET_COMPANY_ID
           LEFT JOIN kf_vendor kv ON cc.COMPANY_ID = kv.VEND_ID
           LEFT JOIN COMPA_COMPETITORS comp ON cc.COMPANY_ID = comp.COMPET_COMPANY_ID
           WHERE cc.COMPANY_ID IN (${competitorIds.map(() => "?").join(",")})`,
          competitorIds
        )
      : [];
    
    // Update company and competitors with fresh data while preserving Google reviews
    Object.assign(company, updatedCompany);
    updatedCompetitors.forEach((updatedComp, index) => {
      Object.assign(competitors[index], updatedComp);
    });
    
    console.log(`[ReportGeneration] ✅ Social media follower counts updated`);
    console.log(`[ReportGeneration] Company: FB:${company.FB_FOLLOWER_COUNT} IG:${company.INSTA_FOLLOWER_COUNT} LI:${company.LINKEDIN_FOLLOWER_COUNT}`);
    competitors.forEach(comp => {
      console.log(`[ReportGeneration] - ${comp.NAME}: FB:${comp.FB_FOLLOWER_COUNT} IG:${comp.INSTA_FOLLOWER_COUNT} LI:${comp.LINKEDIN_FOLLOWER_COUNT}`);
    });

    // 4. Generate report using the appropriate prompt generator
    let prompt;
    if (reportType === 'swot-analysis') {
      // swot-analysis expects [company] as array
      prompt = REPORT_HANDLERS[reportType]([company], competitors);
    } else {
      prompt = REPORT_HANDLERS[reportType](company, competitors);
    }
    const report = await generateReportWithGroq(prompt, reportType, null, userid, firmid);

    // 5. Save report to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, reportType, report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error(`❌ Error generating ${reportType} report:`, err);
    res.status(500).json({
      success: false,
      error: `Failed to generate ${reportType} report.`,
    });
  }
});

// ===============================================================================
// DEPRECATED INDIVIDUAL ENDPOINTS - USE /api/generate-report/:reportType INSTEAD
// These are kept for backward compatibility but should be migrated to the unified endpoint
// ===============================================================================

// SWOT Analysis generation endpoint - DEPRECATED
app.post("/api/generate-swot-analysis", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body || {};

  if (!companyId) {
    return res.status(400).json({
      success: false,
      error: "companyId is required.",
    });
  }

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[SWOT] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[SWOT] Unable to load saved preferences:`, e?.message);
      }
    }
    // Get company data
    const [company] = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
              sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    // Get competitors data if any
    const competitors = competitorIds.length
      ? await db.query(
          `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
                  sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
                  sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT
           FROM COMPA_COMPANIES cc
           LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
           WHERE cc.COMPANY_ID IN (${competitorIds.map(() => "?").join(",")})`,
          competitorIds
        )
      : [];

    // Generate SWOT analysis using the new enhanced prompt
    const prompt = generateSWOTPrompt([company], competitors);
    const swotAnalysis = await generateReportWithGroq(prompt, 'swot-analysis', null, userid, firmid);

    // Save report to business books table
    if (swotAnalysis && swotAnalysis.content) {
      await saveReportToBusinessBooks(companyId, 'swot-analysis', swotAnalysis.content, userid, firmid);
    }

    res.json({ 
      success: true, 
      report: swotAnalysis,
      // Legacy response format for compatibility
      swotAnalysis: swotAnalysis?.content || swotAnalysis,
      companyInfo: [company],
      followers: competitors
    });
  } catch (err) {
    console.error(`❌ Error generating SWOT analysis:`, err);
    res.status(500).json({
      success: false,
      error: `Failed to generate SWOT analysis.`,
    });
  }
});

// Report Generation Endpoints
app.post("/api/generate-competitor-analysis", async (req, res) => {
  // Default competitorIds to an empty array to avoid SQL errors when not provided
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // If competitorIds are not provided, attempt to load from saved preferences
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[CompetitorAnalysis] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[CompetitorAnalysis] Unable to load saved preferences:`, e?.message);
      }
    }

    // 1. Scrape fresh follower data
    console.log(`[CompetitorAnalysis] Scraping follower data for company ${companyId} and ${competitorIds.length} competitors...`);
    const scrapingResult = await followerService.ensureFollowerData(companyId, competitorIds);
    
    if (scrapingResult.success) {
      console.log(`[CompetitorAnalysis] Scraping complete: ${scrapingResult.summary.totalScraped} scraped, ${scrapingResult.summary.totalCached} cached, ${scrapingResult.summary.totalFailed} failed`);
    } else {
      console.warn(`[CompetitorAnalysis] Scraping had issues: ${scrapingResult.error}`);
    }

    // 2. Gather company and competitor data with fresh follower counts
    const companyData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
              sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT 
       FROM COMPA_COMPANIES cc 
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );

    if (!companyData || companyData.length === 0) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    const competitorsData = competitorIds.length
      ? await db.query(
          `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
                  sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
                  sf.SNAPCHAT_FOLLOWER_COUNT 
           FROM COMPA_COMPANIES cc 
           LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPET_COMPANY_ID 
           WHERE cc.COMPANY_ID IN (${competitorIds.map(() => '?').join(',')})`,
          competitorIds
        )
      : [];

    const prompt = generateCompetitorAnalysisPrompt(companyData[0], competitorsData);
    const report = await generateReportWithGroq(prompt, "competitor-analysis", null, userid, firmid);

    // Save competitor analysis to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'competitor-analysis', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating competitor analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate competitor analysis." });
  }
});

app.post("/api/generate-market-share", async (req, res) => {
  // Default competitorIds to an empty array
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[MarketShare] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[MarketShare] Unable to load saved preferences:`, e?.message);
      }
    }
    let marketData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, sf.FB_FOLLOWER_COUNT, 
              sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT, 
              sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT, cc.WEBSITE
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (marketData && !Array.isArray(marketData)) {
      marketData = [marketData];
    }

    const prompt = generateMarketSharePrompt(marketData);
    const report = await generateReportWithGroq(prompt, "market-share", null, userid, firmid);

    // Save market share to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'market-share', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating market share analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate market share analysis." });
  }
});

app.post("/api/generate-content-gap", async (req, res) => {
  // Default competitorIds to an empty array
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[ContentGap] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[ContentGap] Unable to load saved preferences:`, e?.message);
      }
    }
    let contentData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, sf.FB_FOLLOWER_COUNT, 
              sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT, 
              sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT, cc.WEBSITE
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (contentData && !Array.isArray(contentData)) {
      contentData = [contentData];
    }

    const prompt = generateContentGapPrompt(contentData);
    const report = await generateReportWithGroq(prompt, "content-gap", null, userid, firmid);

    // Save content gap to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'content-gap', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating content gap analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate content gap analysis." });
  }
});


/**
 * Register a new company and its social URLs
 * @route POST /api/register-company
 * @body companyName, companyUrl, industry, contactEmail, facebookUrl, googleUrl, linkedinUrl, instagramUrl
 * Inserts into COMPA_COMPANIES and SMP_FOLLOWERS
 */
app.post('/api/register-company', async (req, res) => {
  const {
    companyName,
    companyUrl,
    industry,
    region,
    contactEmail,
    facebookUrl,
    googleUrl,
    linkedinUrl,
    instagramUrl,
    userid,
    firmid
  } = req.body || {};

  // Basic validation
  if (!companyName || !industry) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }

  try {
    // Step 1: Insert into kf_vendor first to get VEND_ID
    const vendorResult = await db.query(
      `INSERT INTO kf_vendor (
        VEND_TITL, VEND_URL, VEND_IND_INF, COMPANY_NAME, INDUSTRY_TYPE,
        CITY, STATE, COUNTRY,
        PORTAL_ID, MEMBERID, VEND_SDATE, INSRT_DTM,
        email, VEND_CATEGRY, CATEGORY_ID,
        FB_PAGE_URL, INSTA_PAGE_URL, LINKEDIN_PAGE_URL, GOOGLE_RVW_LINK,
        STATUS, UPDATE_DTM
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), NOW(), ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW())`,
      [
        companyName.trim(),
        companyUrl ? companyUrl.trim() : '',
        industry.trim(),
        companyName.trim(),
        industry.trim(),
        region ? region.trim() : '',
        region ? region.trim() : '',
        region ? region.trim() : '',
        userid || 0,
        userid || 0,
        contactEmail ? contactEmail.trim() : null,
        industry.trim(),
        0,
        facebookUrl ? facebookUrl.trim() : null,
        instagramUrl ? instagramUrl.trim() : null,
        linkedinUrl ? linkedinUrl.trim() : null,
        googleUrl ? googleUrl.trim() : null
      ]
    );
    const vendorId = vendorResult.insertId;
    console.log(`✅ Inserted into kf_vendor with VEND_ID: ${vendorId}`);

    // Step 2: Insert into COMPA_COMPANIES using VEND_ID as COMPANY_ID
    await db.query(
      `INSERT INTO COMPA_COMPANIES (COMPANY_ID, NAME, WEBSITE, INDUSTRY) VALUES (?, ?, ?, ?)`,
      [vendorId, companyName.trim(), companyUrl ? companyUrl.trim() : '', industry.trim()]
    );
    console.log(`✅ Inserted into COMPA_COMPANIES with COMPANY_ID: ${vendorId}`);

    // Step 3: Insert social URLs into SMP_FOLLOWERS
    await db.query(
      `INSERT INTO SMP_FOLLOWERS (
        COMPANY_ID, COMPET_COMPANY_ID,
        FB_PAGE_URL, INSTA_PAGE_URL, LINKEDIN_PAGE_URL, GOOGLE_REVIEW_URL,
        STATUS, UPDATE_DTM, ISNRT_DTM
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())`,
      [
        vendorId,
        0, // Set COMPET_COMPANY_ID to 0 for new company registrations
        facebookUrl ? facebookUrl.trim() : null,
        instagramUrl ? instagramUrl.trim() : null,
        linkedinUrl ? linkedinUrl.trim() : null,
        googleUrl ? googleUrl.trim() : null
      ]
    );
    console.log(`✅ Inserted into SMP_FOLLOWERS for COMPANY_ID: ${vendorId}`);

    res.json({ success: true, companyId: vendorId, vendorId: vendorId });
  } catch (err) {
    console.error('❌ Error registering company:', err);
    res.status(500).json({ success: false, error: 'Failed to register company.' });
  }
});










app.post("/api/generate-technical-seo", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[TechnicalSEO] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[TechnicalSEO] Unable to load saved preferences:`, e?.message);
      }
    }
    let seoData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE, 
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
              sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (seoData && !Array.isArray(seoData)) {
      seoData = [seoData];
    }

    const prompt = generateTechnicalSEOPrompt(seoData);
    const report = await generateReportWithGroq(prompt, "technical-seo", null, userid, firmid);

    // Save technical SEO to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'technical-seo', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating technical SEO analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate technical SEO analysis." });
  }
});

app.post("/api/generate-ux-comparison", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[UXComparison] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[UXComparison] Unable to load saved preferences:`, e?.message);
      }
    }
    let uxData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE, 
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
              sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (uxData && !Array.isArray(uxData)) {
      uxData = [uxData];
    }

    const prompt = generateUXComparisonPrompt(uxData);
    const report = await generateReportWithGroq(prompt, "ux-comparison", null, userid, firmid);

    // Save UX comparison to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'ux-comparison', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating UX comparison:", err);
    res.status(500).json({ success: false, error: "Failed to generate UX comparison." });
  }
});

app.post("/api/generate-pricing-comparison", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[PricingComparison] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[PricingComparison] Unable to load saved preferences:`, e?.message);
      }
    }
    let pricingData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE, 
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
              sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (pricingData && !Array.isArray(pricingData)) {
      pricingData = [pricingData];
    }

    const prompt = generatePricingComparisonPrompt(pricingData);
    const report = await generateReportWithGroq(prompt, "pricing-comparison", null, userid, firmid);

    // Save pricing comparison to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'pricing-comparison', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating pricing comparison:", err);
    res.status(500).json({ success: false, error: "Failed to generate pricing comparison." });
  }
});

app.post("/api/generate-brand-presence", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[BrandPresence] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[BrandPresence] Unable to load saved preferences:`, e?.message);
      }
    }
    let brandData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_URL, sf.LINKEDIN_URL, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT 
       FROM COMPA_COMPANIES cc 
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (brandData && !Array.isArray(brandData)) {
      brandData = [brandData];
    }

    const prompt = generateBrandPresencePrompt(brandData);
    const report = await generateReportWithGroq(prompt, "brand-presence", null, userid, firmid);

    // Save brand presence to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'brand-presence', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating brand presence analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate brand presence analysis." });
  }
});

app.post("/api/generate-audience-overlap", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[AudienceOverlap] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[AudienceOverlap] Unable to load saved preferences:`, e?.message);
      }
    }
    let audienceData = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, 
              sf.LINKEDIN_FOLLOWER_COUNT, sf.GOOGLE_REVIEW_COUNT, 
              sf.SNAPCHAT_FOLLOWER_COUNT 
       FROM COMPA_COMPANIES cc 
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID IN (${[companyId, ...competitorIds].map(() => '?').join(',')})
       ORDER BY FIELD(cc.COMPANY_ID, ${[companyId, ...competitorIds].map(() => '?').join(',')})`,
      [companyId, ...competitorIds, companyId, ...competitorIds]
    );

    // Convert single result to array if needed
    if (audienceData && !Array.isArray(audienceData)) {
      audienceData = [audienceData];
    }

    const prompt = generateAudienceOverlapPrompt(audienceData);
    const report = await generateReportWithGroq(prompt, "audience-overlap", null, userid, firmid);

    // Save audience overlap to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'audience-overlap', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating audience overlap analysis:", err);
    res.status(500).json({ success: false, error: "Failed to generate audience overlap analysis." });
  }
});

// Churn Fix Endpoint
app.post("/api/generate-churn-fix", async (req, res) => {
  let { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Fallback to saved preferences when competitorIds not provided
    if (!competitorIds || (Array.isArray(competitorIds) && competitorIds.length === 0)) {
      try {
        const prefRows = await db.query(
          `SELECT COMPETITOR_IDS FROM AIA_SMP_PREFERENCES 
           WHERE COMPANY_ID = ? AND PREF_TYPE = 'COMPA' 
           ORDER BY PREF_ID DESC LIMIT 1`,
          [companyId]
        );
        if (prefRows && prefRows.length > 0 && prefRows[0].COMPETITOR_IDS) {
          const parsed = JSON.parse(prefRows[0].COMPETITOR_IDS || '[]');
          competitorIds = (Array.isArray(parsed) ? parsed : [])
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id > 0);
          console.log(`[ChurnFix] Using saved preference competitor IDs: ${competitorIds.join(', ')}`);
        }
      } catch (e) {
        console.warn(`[ChurnFix] Unable to load saved preferences:`, e?.message);
      }
    }
    const [company] = await db.query(
      `SELECT cc.*, sf.* 
       FROM COMPA_COMPANIES cc 
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );

    if (!company) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    let competitors = [];
    if (competitorIds.length > 0) {
      competitors = await db.query(
        `SELECT cc.*, sf.* 
         FROM COMPA_COMPANIES cc 
         LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
         WHERE cc.COMPANY_ID IN (${competitorIds.map(() => '?').join(',')})`,
               competitorIds
      );
    }

    const prompt = generateChurnFixPrompt(company, competitors);
    const report = await generateReportWithGroq(prompt, "churn-fix", null, userid, firmid);

    // Save churn fix report to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, 'churn-fix', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating churn fix plan:", err);
    res.status(500).json({ success: false, error: "Failed to generate churn fix plan." });
  }
});

// Update 30-60-90 Plan Endpoint to save to business books
app.post("/api/generate-30-60-90-plan", async (req, res) => {
  const { companyId, competitorIds = [], userid, firmid } = req.body;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });

  try {
    // Get company data
    const [company] = await db.query(
      `SELECT cc.*, sf.* 
       FROM COMPA_COMPANIES cc 
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );

    if (!company) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    // Get competitors data if any
    let competitors = [];
    if (competitorIds.length > 0) {
      competitors = await db.query(
        `SELECT cc.*, sf.* 
         FROM COMPA_COMPANIES cc 
         LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID 
         WHERE cc.COMPANY_ID IN (${competitorIds.map(() => '?').join(',')})`,
        competitorIds
      );
    }

    const prompt = generate306090Prompt(company, competitors);
    const report = await generateReportWithGroq(prompt, "30-60-90-plan", null, userid, firmid);

    // Save 30-60-90 plan to business books table
    if (report && report.content) {
      await saveReportToBusinessBooks(companyId, '30-60-90-plan', report.content, userid, firmid);
    }

    res.json({ success: true, report });
  } catch (err) {
    console.error("❌ Error generating 30-60-90 plan:", err);
    res.status(500).json({ success: false, error: "Failed to generate 30-60-90 plan." });
  }
});

// Add summary report endpoint
app.post("/api/generate-summary-report", async (req, res) => {
  
   const { companyId, reports, userid, firmid } = req.body;
  if (!companyId || !reports || !Array.isArray(reports) || reports.length === 0) {
    return res.status(400).json({ error: "companyId and reports array are required." });
  }
  try {
    // Instead of including full report text, just list the report topics/titles
    const reportTitles = reports.map((r, i) => `Report ${i+1}`).join(', ');
    const prompt = `You are an expert business analyst and storyteller. Given the following report topics for a company, generate a new, concise, visually rich summary (minimum 5 pages, maximum 7 pages if printed). Use the SAME formatting as the detailed reports (including markdown tables, charts, and graphs) for consistency. The summary should be very short, precise, and easy to read, more like an executive summary or business book. Do NOT use bullet points. Use simple paragraphs, short sentences, and clear language. Use tables, bar charts, pie charts, or line graphs (in markdown) to convey key data and trends. Focus on the most important insights, trends, and actionable recommendations. Avoid fluff and repetition. Make it feel like a premium business summary for top executives.\n\nCompany ID: ${companyId}\n\nReport Topics: ${reportTitles}\n\nReturn only the summary in markdown format.`;
    const summary = await generateReportWithGroq(prompt, "summary-report", null, userid, firmid);

    // Save summary report to business books table
    if (summary && summary.content) {
      await saveReportToBusinessBooks(companyId, 'summary-report', summary.content, userid, firmid);
    }

    res.json({ success: true, summary });
  } catch (err) {
    console.error("❌ Error generating summary report:", err);
    res.status(500).json({ success: false, error: "Failed to generate summary report." });
  }
});

// Action Plan Prompt Generator - Focused on iterative improvement based on previous plan + user feedback
function generateActionPlanPrompt(company, competitor, userInput, status, existingActionPlan) {
  const { dateNote } = getCurrentDateContext();
  let prompt = `${dateNote}\n\nYou are a business strategist. `;
  
  // Check if there's an existing action plan to build upon
  if (existingActionPlan && (existingActionPlan.USER_INPUT || existingActionPlan.STEP_ACTION)) {
    prompt += `\n=== TASK: IMPROVE EXISTING ACTION PLAN ===\n`;
    prompt += `For the company "${company.NAME}" (${company.INDUSTRY} industry) competing against "${competitor.NAME}".\n\n`;
    
    prompt += `--- PREVIOUS ACTION PLAN ---\n`;
    prompt += `Status: "${existingActionPlan.STATUS || 'unknown'}"\n`;
    prompt += `Created: ${existingActionPlan.CREATED_AT}\n`;
    prompt += `Last Updated: ${existingActionPlan.UPDATED_AT || existingActionPlan.CREATED_AT}\n\n`;
    
    const previousPlan = existingActionPlan.USER_INPUT?.trim() || existingActionPlan.STEP_ACTION?.trim();
    prompt += `Previous Plan Content:\n${previousPlan}\n`;
    prompt += `--- END PREVIOUS PLAN ---\n\n`;
    
    // User feedback is critical for iteration
    if (userInput && userInput.trim()) {
      prompt += `=== USER FEEDBACK FOR IMPROVEMENT ===\n`;
      prompt += `The user has provided this feedback to improve the action plan:\n"${userInput.trim()}"\n`;
      prompt += `This feedback is CRITICAL - incorporate it directly into the new plan.\n`;
      prompt += `=== END USER FEEDBACK ===\n\n`;
    }
    
    // Status-based guidance
    prompt += `=== CURRENT STATUS & INSTRUCTIONS ===\n`;
    prompt += `Current Status: "${status || 'pending'}"\n\n`;
    
    if (status === 'done' || status === 'skipped') {
      prompt += `Since the previous plan is marked as "${status}", generate a NEW, MORE ADVANCED action plan that:\n`;
      prompt += `- Builds on what was accomplished in the previous plan\n`;
      prompt += `- Addresses the next level of strategic initiatives\n`;
      prompt += `- Incorporates any user feedback provided\n`;
      prompt += `- Takes the competitive strategy to the next phase\n`;
    } else if (status === 'in-progress') {
      prompt += `The plan is in-progress. Generate an IMPROVED version that:\n`;
      prompt += `- Refines and enhances the existing action items\n`;
      prompt += `- Incorporates the user's feedback to address gaps or concerns\n`;
      prompt += `- Adds more specific, actionable details where needed\n`;
      prompt += `- Maintains continuity with ongoing work\n`;
    } else {
      prompt += `The plan is pending. Generate an ENHANCED version that:\n`;
      prompt += `- Improves upon the previous plan based on user feedback\n`;
      prompt += `- Makes actions more specific and measurable\n`;
      prompt += `- Addresses any weaknesses or gaps identified\n`;
      prompt += `- Provides clearer implementation guidance\n`;
    }
    prompt += `=== END INSTRUCTIONS ===\n\n`;
    
  } else {
    // No existing plan - generate fresh plan
    prompt += `Generate a comprehensive action plan for "${company.NAME}" in the "${company.INDUSTRY}" industry to overcome competitor "${competitor.NAME}".\n\n`;
    
    if (userInput && userInput.trim()) {
      prompt += `=== USER REQUIREMENTS ===\n`;
      prompt += `The user has specified these requirements:\n"${userInput.trim()}"\n`;
      prompt += `Make sure to address these requirements in the action plan.\n`;
      prompt += `=== END USER REQUIREMENTS ===\n\n`;
    }
    
    if (status) {
      prompt += `Initial Status: "${status}"\n\n`;
    }
  }
  
  prompt += `\n=== ACTION PLAN OUTPUT FORMAT ===\n`;
  prompt += `Create a comprehensive, actionable plan with:\n`;
  prompt += `1. Clear prioritization (Immediate/Short-term/Long-term)\n`;
  prompt += `2. Specific, measurable actions\n`;
  prompt += `3. Time-bound objectives\n`;
  prompt += `4. Actionable steps across key business areas:\n`;
  prompt += `   - Digital Marketing & Social Media Strategy\n`;
  prompt += `   - Content & SEO Optimization\n`;
  prompt += `   - Brand Positioning & Messaging\n`;
  prompt += `   - Customer Experience & Engagement\n`;
  prompt += `   - Competitive Differentiation\n`;
  prompt += `   - Performance Metrics & KPIs\n\n`;
  
  prompt += `Return as a well-organized bullet-point list. NO checkboxes, dropdowns, or input fields.\n\n`;
  prompt += `Example format:\n`;
  prompt += `**Immediate Actions (0-30 days):**\n- Specific action step 1\n- Specific action step 2\n\n`;
  prompt += `**Short-term Strategy (1-3 months):**\n- Strategic initiative 1\n- Strategic initiative 2\n\n`;
  prompt += `**Long-term Goals (3-12 months):**\n- Long-term objective 1\n- Long-term objective 2\n`;
  
  return prompt;
}

// Endpoint to generate Action Plan report for a selected competitor
app.post("/api/generate-action-plan", async (req, res) => {
  const { companyId, competitorId, userid, firmid, userInput, status } = req.body;
  if (!companyId || !competitorId) {
    return res.status(400).json({ error: "companyId and competitorId are required." });
  }
  // Validate status against enum values
  const validStatus = ['pending', 'in-progress', 'done', 'skipped'];
  const statusToStore = validStatus.includes(status) ? status : 'pending';
  try {
    // Get company and competitor data
    const [company] = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
              sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID = ?`,
      [companyId]
    );
    const [competitor] = await db.query(
      `SELECT cc.COMPANY_ID, cc.NAME, cc.INDUSTRY, cc.WEBSITE,
              sf.FB_FOLLOWER_COUNT, sf.INSTA_FOLLOWER_COUNT, sf.LINKEDIN_FOLLOWER_COUNT,
              sf.GOOGLE_REVIEW_COUNT, sf.SNAPCHAT_FOLLOWER_COUNT
       FROM COMPA_COMPANIES cc
       LEFT JOIN SMP_FOLLOWERS sf ON cc.COMPANY_ID = sf.COMPANY_ID
       WHERE cc.COMPANY_ID = ?`,
      [competitorId]
    );
    if (!company || !competitor) {
      return res.status(404).json({ error: "Company or competitor not found." });
    }

    // Get existing action plan if it exists
    let existingActionPlan = null;
    try {
      const [existing] = await db.query(
        `SELECT STEP_ACTION, INPUT_TYPE, STATUS, USER_INPUT, CREATED_AT, UPDATED_AT
         FROM SMB_ACTION_LOGS
         WHERE COMPANY_ID = ? AND COMPETITOR_ID = ? AND STEP_ID = 'action-plan' AND ACTION_TYPE = 'COMPA' AND USERID = ? AND FIRMID = ?
         ORDER BY UPDATED_AT DESC
         LIMIT 1`,
        [companyId, competitorId, userid, firmid]
      );
      if (existing) {
        existingActionPlan = existing;
        console.log(`[ActionPlan] Found existing action plan with status: ${existing.STATUS}`);
      }
    } catch (err) {
      console.log("No existing action plan found or error fetching:", err);
    }

    // Generate improved action plan based ONLY on: old plan + user input + status
    // No longer fetching company/competitor reports - focus on iterative improvement
    const prompt = generateActionPlanPrompt(company, competitor, userInput, statusToStore, existingActionPlan);
    
    console.log(`[ActionPlan] Generating ${existingActionPlan ? 'improved' : 'new'} action plan for ${company.NAME} vs ${competitor.NAME}`);
    if (userInput) {
      console.log(`[ActionPlan] User input: ${userInput.substring(0, 100)}${userInput.length > 100 ? '...' : ''}`);
    }
    
    // Let generateReportWithGroq handle the API key and provider detection
    const report = await generateReportWithGroq(prompt, "action-plan", null, userid, firmid);

    // Save action plan and user input to SMB_ACTION_LOGS
    if (report && report.content) {
      // Store the action plan content in USER_INPUT (2000 chars limit) 
      // and a simple label in STEP_ACTION (1000 chars limit)
      const actionPlanContent = typeof report.content === "string" ? report.content.substring(0, 2000) : "";
      const stepAction = "Action Plan Generated";
      
      await db.execute(
        `INSERT INTO SMB_ACTION_LOGS 
          (COMPANY_ID, COMPETITOR_ID, STEP_ID, STEP_ACTION, INPUT_TYPE, STATUS, USER_INPUT, ACTION_TYPE, USERID, FIRMID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          competitorId,
          "action-plan",
          stepAction,
          "text",
          statusToStore,
          actionPlanContent,
          "COMPA",
          userid,
          firmid
        ]
      );
    }

    // Return the content as a string, not the entire report object
    res.json({ success: true, report: report.content || report });
  } catch (err) {
    console.error("❌ Error generating action plan:", err);
    res.status(500).json({ success: false, error: "Failed to generate action plan." });
  }
});

// Endpoint to get existing action plan for a competitor
app.get("/api/get-action-plan", async (req, res) => {
  const { companyId, competitorId, userid, firmid } = req.query;
  if (!companyId || !competitorId || !userid || !firmid) {
    return res.status(400).json({ error: "companyId, competitorId, userid, and firmid are required." });
  }
  try {
    const [actionPlan] = await db.query(
      `SELECT STEP_ACTION, INPUT_TYPE, STATUS, USER_INPUT, CREATED_AT, UPDATED_AT
       FROM SMB_ACTION_LOGS
       WHERE COMPANY_ID = ? AND COMPETITOR_ID = ? AND STEP_ID = 'action-plan' AND ACTION_TYPE = 'COMPA' AND USERID = ? AND FIRMID = ?
       ORDER BY UPDATED_AT DESC
       LIMIT 1`,
      [companyId, competitorId, userid, firmid]
    );
    if (actionPlan) {
      res.json({ success: true, actionPlan });
    } else {
      res.json({ success: true, actionPlan: null });
    }
  } catch (err) {
    console.error("❌ Error fetching action plan:", err);
    res.status(500).json({ success: false, error: "Failed to fetch action plan." });
  }
});

// Endpoint to log user action for a step (for updating status/input)
app.post("/api/log-action-step", async (req, res) => {
  let { companyId, competitorId, stepId, stepAction, inputType, status, userInput, actionType, userid, firmid } = req.body;
  if (!companyId || !competitorId || !stepId || !stepAction || !inputType || !actionType) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  // Validate enums for INPUT_TYPE and STATUS
  const validInputTypes = ['checkbox', 'text', 'dropdown'];
  const validStatus = ['pending', 'in-progress', 'done', 'skipped'];
  if (!validInputTypes.includes(inputType)) inputType = 'text';
  if (!validStatus.includes(status)) status = 'pending';
  // Validate ACTION_TYPE
  const validActionTypes = ['COMPA', 'REPA', 'OTHER'];
  if (!validActionTypes.includes(actionType)) actionType = 'COMPA';
  // Fix: Truncate USER_INPUT to 2000 chars and STEP_ACTION to 1000 chars to fit DB columns
  if (typeof userInput === "string") {
    userInput = userInput.substring(0, 2000);
  }
  if (typeof stepAction === "string") {
    stepAction = stepAction.substring(0, 1000);
  }
  try {
    // APPEND-ONLY: Always insert new records, never update existing ones
    // This ensures all action plans are preserved and never overwritten
    await db.execute(
      `INSERT INTO SMB_ACTION_LOGS 
        (COMPANY_ID, COMPETITOR_ID, STEP_ID, STEP_ACTION, INPUT_TYPE, STATUS, USER_INPUT, ACTION_TYPE, USERID, FIRMID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, competitorId, stepId, stepAction, inputType, status, userInput, actionType, userid, firmid]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error logging action step:", err);
    res.status(500).json({ success: false, error: "Failed to log action step." });
  }
});

// Endpoint to fetch action logs for a company/competitor (for action plan retrieval)
app.get("/api/get-action-logs", async (req, res) => {
  const { companyId, competitorId, actionType } = req.query;
  if (!companyId || !competitorId || !actionType) {
    return res.status(400).json({ error: "companyId, competitorId, and actionType are required." });
  }
  try {
    // Only fetch the action plan step for action plan retrieval
    const logs = await db.query(
      `SELECT * FROM SMB_ACTION_LOGS WHERE COMPANY_ID = ? AND COMPETITOR_ID = ? AND ACTION_TYPE = ? AND STEP_ID = 'action-plan' ORDER BY CREATED_AT DESC LIMIT 1`,
      [companyId, competitorId, actionType]
    );
    res.json({ success: true, logs });
  } catch (err) {
    console.error("❌ Error fetching action logs:", err);
    res.status(500).json({ success: false, error: "Failed to fetch action logs." });
  }
});

// Endpoint to get saved reports for a user and specific company
app.get("/api/saved-reports", async (req, res) => {
  const { userid, firmid, companyId } = req.query;
  
  if (!userid || !firmid) {
    return res.status(400).json({ 
      success: false, 
      error: "userid and firmid are required." 
    });
  }

  try {
    let query = `SELECT 
        bb.BOOK_TITLE,
        bb.BOOK_TYPE,
        bb.BOOK_CONTENT,
        bb.RAG_DTM as CREATED_DATE,
        bb.VENDOR_ID as COMPANY_ID,
        cc.NAME as COMPANY_NAME
       FROM BUSINESS_BOOKS bb
       LEFT JOIN COMPA_COMPANIES cc ON bb.VENDOR_ID = cc.COMPANY_ID
       WHERE bb.PERSONID = ? AND bb.PROGRAMID = ?`;
    
    let params = [userid, firmid];
    
    // If companyId is provided, filter by that company
    if (companyId) {
      query += ` AND bb.VENDOR_ID = ?`;
      params.push(companyId);
    }
    
    query += ` ORDER BY bb.RAG_DTM DESC`;
    
    const reports = await db.query(query, params);
    
    res.json({ 
      success: true, 
      reports: reports || [] 
    });
  } catch (err) {
    console.error("❌ Error fetching saved reports:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch saved reports." 
    });
  }
});

// Endpoint to get default user and firm IDs
app.get("/api/default-ids", (req, res) => {
  // Deprecated: frontend should read IDs from URL directly
  return res.json({
    success: true,
    deprecated: true,
    message: 'Deprecated endpoint. Supply ?userid & ?firmid in app URL; endpoint retained only for backward compatibility.',
    data: {
      userId: req.query.userid || null,
      firmId: req.query.firmid || null
    }
  });
});

app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));
