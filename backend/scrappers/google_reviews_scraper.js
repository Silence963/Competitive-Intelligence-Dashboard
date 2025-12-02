const puppeteer = require('puppeteer');

/**
 * Helper function to replace deprecated page.waitForTimeout
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Scrape Google Maps reviews for a given company
 * @param {Object} company - Company object with VEND_TITL, VEND_CON_ADDR, etc.
 * @param {Object} options - Scraping options
 * @returns {Object} - { reviews: Array, totalAvailable: number }
 */
async function getGoogleReviews(company, options = {}) {
  const {
    maxReviews = Infinity,  // No limit - collect all reviews
    includeMeta = true,
    waitSecs = 2000,
    scrollPause = 1500,  // Reduced for faster scraping
    maxStagnant = 6,     // Balanced attempts
    existingReviews = [], // For duplicate detection
    isFirstTime = false   // First time scraping flag
  } = options;

  // Get company name - use VEND_TITL as primary field
  let companyName = company.VEND_TITL;
  const companyAddress = company.VEND_CON_ADDR;
  
  // Handle cases where VEND_TITL is null or empty
  if (!companyName || companyName.trim() === '') {
    companyName = company.COMPANY_NAME || 
                  company.NAME || 
                  company.VENDOR_NAME || 
                  company.BUSINESS_NAME || 
                  `Company_${company.VEND_ID || 'Unknown'}`;
    console.log(`VEND_TITL was null/empty, using alternative: ${companyName}`);
  }
  
  // Combine company name with address for better search accuracy
  let searchTerm = companyName;
  if (companyAddress && companyAddress.trim()) {
    searchTerm = `${companyName}, ${companyAddress.trim()}`;
    console.log(`Using combined search term: ${searchTerm}`);
  } else {
    console.log(`No address found (VEND_CON_ADDR), using name only: ${searchTerm}`);
  }
  
  const googleReviewLink = company.GOOGLE_RVW_LINK;
  console.log(`Attempting to scrape reviews for: ${companyName}`);
  
  // Validate that we have a usable search term
  if (!searchTerm || searchTerm.trim().length < 2) {
    console.error(`Search term '${searchTerm}' is too short or empty. Cannot search.`);
    return [];
  }

  let browser;
  const results = [];
  let totalReviewCount = 0;
  let duplicateFound = false;
  
  try {
    // Launch browser in headless mode
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    browser = await puppeteer.launch({
      headless: true,  // Headless mode for production
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions'
      ]
    });
    
    const page = await browser.newPage();
    
    // Close all other pages/tabs - keep only one tab
    const pages = await browser.pages();
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] !== page) {
        await pages[i].close();
      }
    }
    
    // Set viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Prevent new tabs/windows from opening
    page.on('popup', async popup => {
      await popup.close();
    });
    
    await page.evaluateOnNewDocument(() => {
      window.open = function() { return null; };
    });
    
    // Navigate to Google Maps or direct review link
    if (googleReviewLink && googleReviewLink !== 'Not Available') {
      console.log(`Using provided Google review link: ${googleReviewLink}`);
      await page.goto(googleReviewLink, { waitUntil: 'networkidle2' });
    } else {
      console.log(`Searching Google Maps for: ${companyName}`);
      // Prefer direct search URL to land on results faster
      const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchTerm)}`;
      await page.goto(mapsSearchUrl, { waitUntil: 'networkidle2' });
      
      // Handle consent popups
      try {
        const consentButton = await page.waitForSelector('button[aria-label*="Accept"], button:has-text("Accept all"), button:has-text("I agree")', { timeout: 3000 });
        if (consentButton) {
          await consentButton.click();
          console.log('Clicked consent button');
          await delay(1000);
        }
      } catch (error) {
        // Ignore consent popup errors
      }
    }
    
    // Helper: click first element whose text includes a phrase
    async function clickElementByText(page, selectors, text, timeout = 5000) {
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout });
          const handles = await page.$$(selector);
          for (const h of handles) {
            const t = await h.evaluate(el => (el.textContent || '').trim());
            if (t && t.toLowerCase().includes(text.toLowerCase())) {
              await h.click();
              return true;
            }
          }
        } catch (_) {
          continue;
        }
      }
      return false;
    }

    // Click on Reviews tab
    let reviewsClicked = false;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Try to extract total review count from the page
        try {
          const reviewCountText = await page.evaluate(() => {
            // Look for "209 reviews" text next to ratings
            const textNodes = Array.from(document.querySelectorAll('button, div, span'));
            for (const node of textNodes) {
              const text = node.textContent || '';
              const match = text.match(/(\d+)\s*reviews?/i);
              if (match) {
                return parseInt(match[1]);
              }
            }
            return 0;
          });
          if (reviewCountText > 0) {
            totalReviewCount = reviewCountText;
            console.log(`📊 Total reviews available: ${totalReviewCount}`);
          }
        } catch (error) {
          // Continue if count extraction fails
        }
        
        // Try different selectors and pick element containing the text 'Reviews'
        const reviewsSelectors = [
          'button',
          '[role="tab"]',
          'div[role="tab"]',
          'div button',
          'div'
        ];
        reviewsClicked = await clickElementByText(page, reviewsSelectors, 'Reviews', 4000);
        if (reviewsClicked) console.log('Clicked Reviews tab');
        
        if (reviewsClicked) {
          await delay(4000);
          break;
        }
      } catch (error) {
        console.warn(`Attempt ${attempt + 1}: Could not find Reviews tab:`, error.message);
        await delay(2000);
      }
    }
    
    if (!reviewsClicked) {
      console.error('Failed to find/click Reviews tab after 3 attempts');
      return [];
    }
    
    // Try to click "More reviews" if present
    try {
      const clicked = await clickElementByText(page, ['button', 'div button', 'div'], 'More reviews', 2000);
      if (clicked) {
        console.log('Clicked More reviews button');
        await delay(2000);
      }
    } catch (error) {
      // More reviews button not found, continue
    }
    
    // Find scrollable reviews container
    const scrollableContainer = await findReviewsContainer(page);
    if (!scrollableContainer) {
      console.error('Could not locate reviews scroll container');
      return {
        reviews: [],
        totalAvailable: totalReviewCount,
        scrapedCount: 0,
        isFirstTime: isFirstTime,
        duplicateDetected: false
      };
    }
    
    // Scrolling and collection loop
    const seenIds = new Set();
    let stagnantScrolls = 0;
    let lastCount = 0;
    let consecutiveNoNewReviews = 0;
    
    // Create duplicate detection map from existing reviews
    const existingReviewsMap = new Set();
    if (existingReviews && existingReviews.length > 0) {
      existingReviews.forEach(review => {
        const key = `${review.REVIEWER_NAME}|${review.REVIEW_TEXT}`.toLowerCase();
        existingReviewsMap.add(key);
      });
      console.log(`📋 Loaded ${existingReviewsMap.size} existing reviews for duplicate detection`);
    }
    
    if (isFirstTime) {
      console.log(`🔄 FIRST TIME SCRAPING - This will take longer as we collect all ${totalReviewCount} reviews...`);
    } else {
      console.log(`⚡ INCREMENTAL UPDATE - Collecting only new reviews, will stop at first duplicate`);
    }
    
    while (results.length < maxReviews && consecutiveNoNewReviews < 3 && !duplicateFound) {
      // First, scroll to the very top to reset position
      try {
        await page.evaluate((container) => {
          container.scrollTo(0, 0);
        }, scrollableContainer);
        await delay(300);
      } catch (error) {
        // Ignore
      }
      
      // Collect currently visible reviews
      const newReviews = await collectReviewsFromDOM(page, includeMeta, seenIds);
      
      // Check for duplicates in incremental mode
      if (!isFirstTime && newReviews.length > 0) {
        for (const review of newReviews) {
          const reviewKey = `${review.reviewer_name}|${review.text}`.toLowerCase();
          if (existingReviewsMap.has(reviewKey)) {
            console.log(`🛑 DUPLICATE FOUND: "${review.reviewer_name}" - Stopping scrape`);
            duplicateFound = true;
            break;
          }
        }
      }
      
      // Only add non-duplicate reviews
      if (!duplicateFound) {
        results.push(...newReviews);
      }
      
      // If duplicate found in incremental mode, stop immediately
      if (duplicateFound && !isFirstTime) {
        console.log(`✅ Incremental scrape complete. Collected ${results.length} new reviews.`);
        break;
      }
      
      // Check progress
      if (results.length === lastCount) {
        stagnantScrolls++;
        consecutiveNoNewReviews++;
      } else {
        stagnantScrolls = 0;
        consecutiveNoNewReviews = 0;
      }
      
      lastCount = results.length;
      
      // Progress reporting
      if (isFirstTime && totalReviewCount > 0) {
        const progress = Math.round((results.length / totalReviewCount) * 100);
        console.log(`Reviews collected: ${results.length}/${totalReviewCount} (${progress}%) - stagnant=${stagnantScrolls}/${maxStagnant}`);
      } else {
        console.log(`Reviews collected so far: ${results.length} (stagnant=${stagnantScrolls}/${maxStagnant})`);
      }
      
      // Even if stagnant, try aggressive scrolling before giving up
      if (stagnantScrolls >= maxStagnant) {
        console.log('Attempting aggressive scroll to load more reviews...');
        // Scroll to top, then to bottom multiple times
        for (let i = 0; i < 5; i++) {
          try {
            await page.evaluate((container) => {
              container.scrollTo(0, 0); // Top
            }, scrollableContainer);
            await delay(400);
            await page.evaluate((container) => {
              container.scrollTo(0, container.scrollHeight); // Bottom
            }, scrollableContainer);
            await delay(600);
          } catch (error) {
            break;
          }
        }
        // Give it one more chance after aggressive scrolling
        const moreReviews = await collectReviewsFromDOM(page, includeMeta, seenIds);
        
        // Check duplicates in aggressive mode too
        if (!isFirstTime && moreReviews.length > 0) {
          for (const review of moreReviews) {
            const reviewKey = `${review.reviewer_name}|${review.text}`.toLowerCase();
            if (existingReviewsMap.has(reviewKey)) {
              console.log(`🛑 DUPLICATE FOUND during aggressive scroll - Stopping`);
              duplicateFound = true;
              break;
            }
          }
        }
        
        if (!duplicateFound) {
          results.push(...moreReviews);
        }
        
        if (moreReviews.length === 0 || duplicateFound) {
          console.log('No new reviews after aggressive scrolling. Assuming end of list.');
          break;
        } else {
          console.log(`Found ${moreReviews.length} more reviews after aggressive scrolling!`);
          stagnantScrolls = 0;
          consecutiveNoNewReviews = 0;
          lastCount = results.length;
        }
      }
      
      // Scroll DOWN to bottom to load more reviews
      try {
        await page.evaluate((container) => {
          container.scrollTo(0, container.scrollHeight);
        }, scrollableContainer);
        await delay(scrollPause);
      } catch (error) {
        console.error('Scroll error:', error);
        break;
      }
    }
    
    if (isFirstTime && totalReviewCount > 0) {
      const coverage = Math.round((results.length / totalReviewCount) * 100);
      console.log(`✅ Finished. Collected ${results.length}/${totalReviewCount} reviews (${coverage}% coverage)`);
    } else {
      console.log(`✅ Finished. Total reviews collected: ${results.length}`);
    }
    
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  // Return results with metadata
  return {
    reviews: includeMeta ? results : results.map(r => r.text).filter(Boolean),
    totalAvailable: totalReviewCount,
    scrapedCount: results.length,
    isFirstTime: isFirstTime,
    duplicateDetected: duplicateFound
  };
}

// Legacy compatibility - return just array if called without expecting object
const originalGetGoogleReviews = getGoogleReviews;
async function getGoogleReviewsLegacy(company, options = {}) {
  const result = await originalGetGoogleReviews(company, options);
  return result.reviews || result; // Return array for backwards compatibility
}

/**
 * Find the scrollable reviews container
 */
async function findReviewsContainer(page) {
  try {
    // Wait for reviews to be present
    await page.waitForSelector('.jftiEf, .gws-localreviews__google-review, [data-review-id], div[role="article"]', { timeout: 10000 });
    
    // Find the actual scrollable parent container
    const scrollContainer = await page.evaluate(() => {
      // Look for the feed container that holds all reviews
      const feedSelectors = [
        'div.m6QErb[role="feed"]',
        'div.m6QErb.DxyBCb.kA9KIf.dS8AEf',
        'div[role="main"] div.m6QErb',
        'div.review-dialog-list'
      ];
      
      for (const selector of feedSelectors) {
        const elem = document.querySelector(selector);
        if (elem && elem.scrollHeight > elem.clientHeight) {
          return selector;
        }
      }
      
      // Fallback: find any scrollable div containing reviews
      const reviews = document.querySelectorAll('.jftiEf, [data-review-id]');
      if (reviews.length > 0) {
        let parent = reviews[0].parentElement;
        while (parent) {
          if (parent.scrollHeight > parent.clientHeight) {
            parent.setAttribute('data-scroll-container', 'true');
            return '[data-scroll-container="true"]';
          }
          parent = parent.parentElement;
        }
      }
      
      return null;
    });
    
    if (scrollContainer) {
      console.log(`Found scrollable container: ${scrollContainer}`);
      return await page.$(scrollContainer);
    }
    
    return null;
  } catch (error) {
    console.error('Error finding reviews container:', error.message);
    return null;
  }
}

/**
 * Collect reviews from the current DOM state
 */
async function collectReviewsFromDOM(page, includeMeta, seenIds) {
  const newRecords = [];
  
  try {
    // Find review cards
    const reviewCards = await page.$$('.jftiEf, .gws-localreviews__google-review');
    
    for (const card of reviewCards) {
      try {
        // Create unique ID for deduplication
        const cardHtml = await card.evaluate(el => el.innerHTML);
        const cardId = hashCode(cardHtml);
        
        if (seenIds.has(cardId)) {
          continue;
        }
        
        // Expand truncated reviews
        await expandCardIfTruncated(page, card);
        
        // Extract review text
        let text = '';
        try {
          const textElement = await card.$('.wiI7pd, .review-full-text');
          if (textElement) {
            text = await textElement.evaluate(el => el.textContent.trim());
            text = text.replace(/\*+/g, ''); // Remove asterisks
          }
        } catch (error) {
          // Continue if text extraction fails
        }
        
        let ratingVal = null;
        let reviewerName = null;
        let reviewDate = null;
        
        if (includeMeta) {
          // Extract rating
          try {
            const starElement = await card.$('.kvMYJc');
            if (starElement) {
              const ariaLabel = await starElement.evaluate(el => el.getAttribute('aria-label'));
              ratingVal = parseRatingFromAria(ariaLabel);
            }
          } catch (error) {
            // Continue if rating extraction fails
          }
          
          // Extract reviewer name
          try {
            const reviewerElement = await card.$('.d4r55');
            if (reviewerElement) {
              reviewerName = await reviewerElement.evaluate(el => el.textContent.trim());
            }
          } catch (error) {
            // Continue if reviewer extraction fails
          }
          
          // Extract date with robust selectors
          const dateSelectors = ['.PuaHbe', '.rsqaWe', '.dehysf', '.gxMdQe', 'span'];
          for (const selector of dateSelectors) {
            try {
              const dateElements = await card.$$(selector);
              for (const dateEl of dateElements) {
                const dateText = await dateEl.evaluate(el => el.textContent.trim());
                if (isDateText(dateText)) {
                  // Convert relative date to actual date
                  reviewDate = parseRelativeDate(dateText);
                  break;
                }
              }
              if (reviewDate) break;
            } catch (error) {
              continue;
            }
          }
        }
        
        // Only add if we have content
        if (text || includeMeta) {
          newRecords.push({
            text,
            rating: ratingVal,
            reviewer: reviewerName,
            date: reviewDate
          });
          seenIds.add(cardId);
        }
        
      } catch (error) {
        console.warn('Error processing review card:', error);
        continue;
      }
    }
    
  } catch (error) {
    console.error('Error collecting reviews from DOM:', error);
  }
  
  return newRecords;
}

/**
 * Expand truncated review if "More" button is present
 */
async function expandCardIfTruncated(page, card) {
  try {
    const moreButtons = await card.$$('button');
    for (const button of moreButtons) {
      const buttonText = await button.evaluate(el => el.textContent.trim().toLowerCase());
      if (buttonText.includes('more')) {
        await button.click();
        await delay(100);
        break;
      }
    }
  } catch (error) {
    // Continue if expansion fails
  }
}

/**
 * Parse rating from aria-label
 */
function parseRatingFromAria(ariaLabel) {
  if (!ariaLabel) return null;
  
  const match = ariaLabel.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    try {
      return parseFloat(match[1]);
    } catch (error) {
      return null;
    }
  }
  return null;
}

/**
 * Check if text looks like a date
 */
function isDateText(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return ['ago', 'year', 'month', 'week', 'day', 'hour', 'minute'].some(word => 
    lowerText.includes(word)
  );
}

/**
 * Convert relative date text (e.g., "2 months ago") to actual date
 */
function parseRelativeDate(dateText) {
  if (!dateText) return null;
  
  const now = new Date();
  const lowerText = dateText.toLowerCase();
  
  // Extract number from text (e.g., "2 months ago" -> 2)
  const numberMatch = lowerText.match(/(\d+)/);
  const number = numberMatch ? parseInt(numberMatch[1]) : 1;
  
  // Determine time unit and calculate date
  if (lowerText.includes('year')) {
    now.setFullYear(now.getFullYear() - number);
  } else if (lowerText.includes('month')) {
    now.setMonth(now.getMonth() - number);
  } else if (lowerText.includes('week')) {
    now.setDate(now.getDate() - (number * 7));
  } else if (lowerText.includes('day')) {
    now.setDate(now.getDate() - number);
  } else if (lowerText.includes('hour')) {
    now.setHours(now.getHours() - number);
  } else if (lowerText.includes('minute')) {
    now.setMinutes(now.getMinutes() - number);
  }
  
  return now.toISOString();
}

/**
 * Simple hash function for string
 */
function hashCode(str) {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

module.exports = {
  getGoogleReviews
};
