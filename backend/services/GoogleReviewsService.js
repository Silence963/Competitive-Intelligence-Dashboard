const { getGoogleReviews } = require('../scrappers/google_reviews_scraper');
const db = require('../db');

class GoogleReviewsService {
  /**
   * Get or scrape reviews for a company
   * @param {Object} company - Company object with COMPANY_ID, NAME, GOOGLE_RVW_LINK
   * @param {number} userid - User ID
   * @param {number} firmid - Firm ID
   * @param {boolean} forceRefresh - Force scraping even if reviews exist
   * @returns {Object} - { averageRating, totalReviews, topReviews }
   */
  async getCompanyReviews(company, userid, firmid, forceRefresh = false) {
    try {
      const companyId = company.COMPANY_ID;
      
      // Check if we have existing reviews
      if (!forceRefresh) {
        const existingReviews = await this.getStoredReviews(companyId, userid, firmid);
        if (existingReviews && existingReviews.length > 0) {
          console.log(`✅ Using ${existingReviews.length} cached reviews for company ${companyId}`);
          return this.formatReviewsForLLM(existingReviews);
        }
      }
      
      // Scrape new reviews
      console.log(`🔄 Scraping Google reviews for company: ${company.NAME || companyId}`);
      const scrapedData = await this.scrapeAndStoreReviews(company, userid, firmid);
      
      return scrapedData;
      
    } catch (error) {
      console.error(`❌ Error getting reviews for company ${company.COMPANY_ID}:`, error);
      return {
        averageRating: null,
        totalReviews: 0,
        topReviews: []
      };
    }
  }
  
  /**
   * Get stored reviews from database
   */
  async getStoredReviews(companyId, userid, firmid) {
    try {
      const [rows] = await db.pool.query(
        `SELECT 
          REVIEWER_NAME,
          RATING,
          REVIEW_TEXT,
          REVIEW_DATE,
          SENTIMENT,
          POLARITY,
          SOURCE
        FROM COMPANY_REVIEWS
        WHERE COMPANY_ID = ? AND USERID = ? AND FIRMID = ?
        ORDER BY INSERTED_AT DESC
        LIMIT 50`,
        [companyId, userid, firmid]
      );
      
      return rows;
    } catch (error) {
      console.error('Error fetching stored reviews:', error);
      return [];
    }
  }
  
  /**
   * Scrape reviews and store in database
   */
  async scrapeAndStoreReviews(company, userid, firmid) {
    try {
      // Check if Google Review URL is provided
      const googleReviewUrl = company.GOOGLE_RVW_LINK || company.GOGL_RVW_URL;
      
      if (!googleReviewUrl || googleReviewUrl.trim() === '' || googleReviewUrl === 'Not Available') {
        console.log(`⚠️ No Google Review URL provided for company ${company.NAME || company.COMPANY_ID}. Skipping review scraping.`);
        return {
          averageRating: null,
          totalReviews: 0,
          topReviews: []
        };
      }
      
      // Prepare company object for scraper
      const companyForScraper = {
        VEND_TITL: company.NAME,
        VEND_CON_ADDR: company.ADDRESS || '',
        GOOGLE_RVW_LINK: googleReviewUrl,
        VEND_ID: company.COMPANY_ID
      };
      
      console.log(`🔍 Scraping Google reviews from URL: ${googleReviewUrl}`);
      
      // Check for existing reviews to enable incremental scraping
      const existingReviews = await this.getStoredReviews(company.COMPANY_ID, userid, firmid);
      const isFirstTime = existingReviews.length === 0;
      
      // Scrape reviews - limit to 10 reviews
      const result = await getGoogleReviews(companyForScraper, {
        maxReviews: 10, // Only collect first 10 reviews
        includeMeta: true,
        existingReviews: existingReviews,
        isFirstTime: isFirstTime
      });
      
      const reviews = result.reviews || [];
      const totalAvailable = result.totalAvailable || 0;
      
      console.log(`📊 Scraped ${reviews.length} reviews (${totalAvailable} total available)`);
      
      if (reviews.length === 0) {
        console.log('⚠️ No reviews found for this company');
        return {
          averageRating: null,
          totalReviews: 0,
          topReviews: []
        };
      }
      
      // Store reviews in database
      await this.storeReviews(reviews, company.COMPANY_ID, userid, firmid);
      
      // Format for LLM
      return this.formatReviewsForLLM(reviews);
      
    } catch (error) {
      console.error('Error scraping reviews:', error);
      return {
        averageRating: null,
        totalReviews: 0,
        topReviews: []
      };
    }
  }
  
  /**
   * Store reviews in database
   */
  async storeReviews(reviews, companyId, userid, firmid) {
    try {
      const connection = await db.pool.getConnection();
      
      for (const review of reviews) {
        try {
          // Check if review already exists (by reviewer name and text)
          const [existing] = await connection.query(
            `SELECT REVIEW_ID FROM COMPANY_REVIEWS 
             WHERE COMPANY_ID = ? AND USERID = ? AND FIRMID = ? 
             AND REVIEWER_NAME = ? AND REVIEW_TEXT = ?
             LIMIT 1`,
            [companyId, userid, firmid, review.reviewer || 'Anonymous', review.text || '']
          );
          
          if (existing.length > 0) {
            // Review already exists, skip
            continue;
          }
          
          // Analyze sentiment (simple implementation)
          const sentiment = this.analyzeSentiment(review.text, review.rating);
          
          // Insert new review
          await connection.query(
            `INSERT INTO COMPANY_REVIEWS (
              COMPANY_ID,
              USERID,
              FIRMID,
              REVIEWER_NAME,
              RATING,
              REVIEW_TEXT,
              REVIEW_DATE,
              SENTIMENT,
              POLARITY,
              SOURCE,
              INSERTED_AT
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              companyId,
              userid,
              firmid,
              review.reviewer || 'Anonymous',
              review.rating || null,
              review.text || '',
              review.date || null,
              sentiment.sentiment,
              sentiment.polarity,
              'GOOGLE'
            ]
          );
        } catch (error) {
          console.error('Error storing individual review:', error);
          // Continue with next review
        }
      }
      
      connection.release();
      console.log(`✅ Stored ${reviews.length} reviews in database`);
      
    } catch (error) {
      console.error('Error storing reviews:', error);
    }
  }
  
  /**
   * Simple sentiment analysis
   */
  analyzeSentiment(text, rating) {
    if (!text && !rating) {
      return { sentiment: 'NEUTRAL', polarity: 0 };
    }
    
    // Use rating if available
    if (rating !== null && rating !== undefined) {
      if (rating >= 4) return { sentiment: 'POSITIVE', polarity: 0.7 };
      if (rating <= 2) return { sentiment: 'NEGATIVE', polarity: -0.7 };
      return { sentiment: 'NEUTRAL', polarity: 0 };
    }
    
    // Simple text-based sentiment
    const lowerText = (text || '').toLowerCase();
    const positiveWords = ['great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'best', 'perfect'];
    const negativeWords = ['bad', 'terrible', 'awful', 'worst', 'hate', 'poor', 'disappointing'];
    
    let score = 0;
    positiveWords.forEach(word => {
      if (lowerText.includes(word)) score += 1;
    });
    negativeWords.forEach(word => {
      if (lowerText.includes(word)) score -= 1;
    });
    
    if (score > 0) return { sentiment: 'POSITIVE', polarity: Math.min(score * 0.3, 1) };
    if (score < 0) return { sentiment: 'NEGATIVE', polarity: Math.max(score * 0.3, -1) };
    return { sentiment: 'NEUTRAL', polarity: 0 };
  }
  
  /**
   * Format reviews for LLM prompt
   */
  formatReviewsForLLM(reviews) {
    if (!reviews || reviews.length === 0) {
      return {
        averageRating: null,
        totalReviews: 0,
        topReviews: []
      };
    }
    
    // Calculate average rating
    const ratingsOnly = reviews.filter(r => r.RATING || r.rating).map(r => r.RATING || r.rating);
    const averageRating = ratingsOnly.length > 0
      ? (ratingsOnly.reduce((sum, r) => sum + r, 0) / ratingsOnly.length).toFixed(1)
      : null;
    
    // Get top 10 reviews (prioritize recent and high-rated)
    const topReviews = reviews
      .slice(0, 10)
      .map(r => ({
        reviewer: r.REVIEWER_NAME || r.reviewer || 'Anonymous',
        rating: r.RATING || r.rating || null,
        text: r.REVIEW_TEXT || r.text || '',
        date: r.REVIEW_DATE || r.date || null,
        sentiment: r.SENTIMENT || null
      }));
    
    return {
      averageRating: averageRating ? parseFloat(averageRating) : null,
      totalReviews: reviews.length,
      topReviews: topReviews
    };
  }
  
  /**
   * Get reviews for multiple companies (for report generation)
   */
  async getReviewsForCompanies(companies, userid, firmid) {
    const results = {};
    
    for (const company of companies) {
      try {
        const reviews = await this.getCompanyReviews(company, userid, firmid, false);
        results[company.COMPANY_ID] = reviews;
      } catch (error) {
        console.error(`Error getting reviews for company ${company.COMPANY_ID}:`, error);
        results[company.COMPANY_ID] = {
          averageRating: null,
          totalReviews: 0,
          topReviews: []
        };
      }
    }
    
    return results;
  }
}

module.exports = new GoogleReviewsService();
