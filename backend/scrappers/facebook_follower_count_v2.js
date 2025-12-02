const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { By, until } = require('selenium-webdriver');
const mysql = require('mysql2/promise');

class FacebookScraper {
    constructor() {
        this.dbConfig = {
            host: '88.150.227.117',
            user: 'nrktrn_web_admin',
            password: 'GOeg&*$*657',
            database: 'nrkindex_trn'
        };
        this.driver = null;
        this.connection = null;
    }

    async connectDb() {
        try {
            this.connection = await mysql.createConnection(this.dbConfig);
            return true;
        } catch (error) {
            console.error(`[ERROR] Database connection failed: ${error.message}`);
            return false;
        }
    }

    async closeDb() {
        if (this.connection) {
            await this.connection.end();
        }
    }

    async getFacebookUrl(competCompanyId) {
        try {
            const query = `
                SELECT FB_URL, COMPANY_ID
                FROM COMPA_COMPETITORS 
                WHERE COMPET_COMPANY_ID = ? AND FB_URL IS NOT NULL AND FB_URL != ''
                LIMIT 1
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                return {
                    fbUrl: results[0].FB_URL,
                    companyId: results[0].COMPANY_ID
                };
            }
            return { fbUrl: null, companyId: null };
        } catch (error) {
            console.error(`[ERROR] Failed to fetch Facebook URL: ${error.message}`);
            return { fbUrl: null, companyId: null };
        }
    }

    async updateFollowerCount(competCompanyId, companyId, followerCount, fbUrl) {
        try {
            // Check if record exists
            const checkQuery = 'SELECT ID FROM SMP_FOLLOWERS WHERE COMPET_COMPANY_ID = ?';
            const [existing] = await this.connection.execute(checkQuery, [competCompanyId]);
            
            if (existing.length > 0) {
                // Update existing record
                const updateQuery = `
                    UPDATE SMP_FOLLOWERS 
                    SET FB_FOLLOWER_COUNT = ?, FB_PAGE_URL = ?, UPDATE_DTM = NOW()
                    WHERE COMPET_COMPANY_ID = ?
                `;
                await this.connection.execute(updateQuery, [followerCount, fbUrl, competCompanyId]);
            } else {
                // Insert new record
                const insertQuery = `
                    INSERT INTO SMP_FOLLOWERS 
                    (COMPANY_ID, COMPET_COMPANY_ID, FB_FOLLOWER_COUNT, FB_PAGE_URL, STATUS, ISNRT_DTM, UPDATE_DTM)
                    VALUES (?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
                `;
                await this.connection.execute(insertQuery, [companyId, competCompanyId, followerCount, fbUrl]);
            }
            
            console.log(`[DB] Successfully updated Facebook followers for competitor ${competCompanyId}: ${followerCount}`);
            return true;
        } catch (error) {
            console.error(`[ERROR] Failed to update database: ${error.message}`);
            return false;
        }
    }

    async setupDriver() {
        try {
            const options = new chrome.Options();
            options.addArguments('--headless=new');
            options.addArguments('--disable-gpu');
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-dev-shm-usage');
            options.addArguments('--window-size=1920,1080');
            options.setPageLoadStrategy('eager');
            
            console.log('[INFO] Starting Chrome WebDriver...');
            this.driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
            
            await this.driver.manage().setTimeouts({
                implicit: 10000,
                pageLoad: 30000,
                script: 30000
            });
            
            console.log('[INFO] Chrome WebDriver started successfully');
            return true;
        } catch (error) {
            console.error(`[ERROR] Failed to start Chrome WebDriver: ${error.message}`);
            this.driver = null;
            return false;
        }
    }

    async closeDriver() {
        if (this.driver) {
            try {
                await this.driver.quit();
            } catch (error) {
                console.warn(`[WARN] Error closing driver: ${error.message}`);
            }
            this.driver = null;
        }
    }

    extractFollowerCount(text) {
        try {
            // Remove all non-digit/non-K/non-M characters and extract number
            const cleanText = text.toUpperCase().replace(/[^\d.,KMkm]/g, '');
            if (!cleanText) {
                return null;
            }
            
            // Handle K (thousands) and M (millions)
            if (cleanText.includes('K')) {
                const number = parseFloat(cleanText.replace('K', '').replace(/,/g, ''));
                return Math.floor(number * 1000);
            } else if (cleanText.includes('M')) {
                const number = parseFloat(cleanText.replace('M', '').replace(/,/g, ''));
                return Math.floor(number * 1000000);
            } else {
                // Just a number with possible commas
                return parseInt(cleanText.replace(/,/g, ''));
            }
        } catch (error) {
            return null;
        }
    }

    async scrapeFollowers(url) {
        if (!await this.setupDriver()) {
            return null;
        }

        try {
            console.log(`[INFO] Loading Facebook page: ${url}`);
            
            // Set a timeout for page load
            const loadPromise = this.driver.get(url);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Page load timeout')), 25000)
            );
            
            await Promise.race([loadPromise, timeoutPromise]);
            console.log(`[INFO] Page loaded successfully`);
            
            // Wait for page to load
            await this.driver.sleep(3000);
            
            // Try multiple selectors for follower count
            const selectors = [
                '[data-overviewsection="followers"] a',
                '[data-testid="standard_tab_followers"] a',
                'a[href*="followers"]',
                '.x9f619.x1n2onr6.x1ja2u2z span'
            ];
            
            console.log(`[INFO] Searching for follower count...`);
            for (const selector of selectors) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    console.log(`[INFO] Found ${elements.length} elements for selector: ${selector}`);
                    for (const element of elements) {
                        const text = await element.getText();
                        const trimmedText = text.trim();
                        if (/follower|follow|people like/i.test(trimmedText)) {
                            console.log(`[INFO] Found potential follower text: ${trimmedText}`);
                            const count = this.extractFollowerCount(trimmedText);
                            if (count !== null) {
                                console.log(`[INFO] Extracted follower count: ${count}`);
                                return count;
                            }
                        }
                    }
                } catch (error) {
                    console.log(`[WARN] Selector failed: ${selector} - ${error.message}`);
                    continue;
                }
            }
            
            console.log('[INFO] Trying page source method...');
            // Try looking in page source for structured data
            const pageSource = await this.driver.getPageSource();
            
            // Look for specific patterns in page source
            const patterns = [
                /"followerCount":(\d+)/,
                /"followers_count":(\d+)/,
                /(\d+(?:\.\d+)?[KM]?)\s+(?:followers|people like)/i,
                /data-count="(\d+)"/
            ];
            
            for (const pattern of patterns) {
                const matches = pageSource.match(pattern);
                if (matches) {
                    try {
                        const count = this.extractFollowerCount(matches[1]);
                        if (count !== null && count > 0) {
                            return count;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
            
            console.log('[WARN] Could not find follower count using standard methods');
            return null;
            
        } catch (error) {
            console.error(`[ERROR] Error scraping Facebook: ${error.message}`);
            return null;
        } finally {
            await this.closeDriver();
        }
    }

    async checkExistingFollowerCount(competCompanyId) {
        try {
            const query = `
                SELECT FB_FOLLOWER_COUNT, UPDATE_DTM
                FROM SMP_FOLLOWERS 
                WHERE COMPET_COMPANY_ID = ? AND FB_FOLLOWER_COUNT IS NOT NULL
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                const count = results[0].FB_FOLLOWER_COUNT;
                const lastUpdated = results[0].UPDATE_DTM;
                console.log(`[INFO] Facebook follower count already exists: ${count} (last updated: ${lastUpdated})`);
                return { exists: true, count };
            }
            return { exists: false, count: null };
        } catch (error) {
            console.error(`[ERROR] Failed to check existing follower count: ${error.message}`);
            return { exists: false, count: null };
        }
    }

    async run(competCompanyId) {
        if (!await this.connectDb()) {
            return false;
        }
        
        try {
            // Always scrape fresh data (removed caching check)
            console.log(`[INFO] Scraping fresh Facebook data for competitor ${competCompanyId}`);
            
            // Get Facebook URL for the competitor company
            const { fbUrl, companyId } = await this.getFacebookUrl(competCompanyId);
            if (!fbUrl) {
                console.log(`[ERROR] No Facebook URL found for competitor ID: ${competCompanyId}`);
                return false;
            }
            
            console.log(`[INFO] Scraping Facebook followers for competitor ${competCompanyId}: ${fbUrl}`);
            
            // Scrape followers
            const count = await this.scrapeFollowers(fbUrl);
            if (count !== null) {
                // Update database
                const success = await this.updateFollowerCount(competCompanyId, companyId, count, fbUrl);
                if (success) {
                    console.log(`[RESULT] Facebook followers: ${count}`);
                    return true;
                } else {
                    console.log('[ERROR] Failed to update database');
                    return false;
                }
            } else {
                console.log('[RESULT] Failed to fetch Facebook followers.');
                return false;
            }
        } finally {
            await this.closeDb();
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log('Usage: node facebook_follower_count_v2.js <compet_company_id>');
        process.exit(1);
    }
    
    const competCompanyId = process.argv[2];
    
    // Run the scraper
    const scraper = new FacebookScraper();
    const success = await scraper.run(competCompanyId);
    
    // Return success/failure status
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = FacebookScraper;
