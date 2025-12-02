const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { By, until } = require('selenium-webdriver');
const mysql = require('mysql2/promise');

class InstagramScraper {
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

    async getInstagramUrl(competCompanyId) {
        try {
            const query = `
                SELECT INSTA_URL, COMPANY_ID
                FROM COMPA_COMPETITORS 
                WHERE COMPET_COMPANY_ID = ? 
                AND INSTA_URL IS NOT NULL 
                AND INSTA_URL != ''
                AND INSTA_URL LIKE '%instagram.com/%'
                AND INSTA_URL NOT LIKE '%explore/locations%'
                LIMIT 1
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                return {
                    instaUrl: results[0].INSTA_URL,
                    companyId: results[0].COMPANY_ID
                };
            }
            return { instaUrl: null, companyId: null };
        } catch (error) {
            console.error(`[ERROR] Failed to fetch Instagram URL: ${error.message}`);
            return { instaUrl: null, companyId: null };
        }
    }

    async updateFollowerCount(competCompanyId, companyId, followerCount, instaUrl) {
        try {
            // Check if record exists
            const checkQuery = 'SELECT ID FROM SMP_FOLLOWERS WHERE COMPET_COMPANY_ID = ?';
            const [existing] = await this.connection.execute(checkQuery, [competCompanyId]);
            
            if (existing.length > 0) {
                // Update existing record
                const updateQuery = `
                    UPDATE SMP_FOLLOWERS 
                    SET INSTA_FOLLOWER_COUNT = ?, INSTA_PAGE_URL = ?, UPDATE_DTM = NOW()
                    WHERE COMPET_COMPANY_ID = ?
                `;
                await this.connection.execute(updateQuery, [followerCount, instaUrl, competCompanyId]);
            } else {
                // Insert new record
                const insertQuery = `
                    INSERT INTO SMP_FOLLOWERS 
                    (COMPANY_ID, COMPET_COMPANY_ID, INSTA_FOLLOWER_COUNT, INSTA_PAGE_URL, STATUS, ISNRT_DTM, UPDATE_DTM)
                    VALUES (?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
                `;
                await this.connection.execute(insertQuery, [companyId, competCompanyId, followerCount, instaUrl]);
            }
            
            console.log(`[DB] Successfully updated Instagram followers for competitor ${competCompanyId}: ${followerCount}`);
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
            console.log(`[INFO] Loading Instagram page: ${url}`);
            await this.driver.get(url);
            
            // Wait for page to load
            await this.driver.sleep(10000);
            
            // Try to handle login popup if it appears
            try {
                const notNowButton = await this.driver.findElement(By.xpath("//button[contains(text(), 'Not Now')]"));
                await notNowButton.click();
                await this.driver.sleep(2000);
            } catch (error) {
                // Popup didn't appear, continue
            }
            
            // Try to find followers count in meta tags
            try {
                const meta = await this.driver.wait(
                    until.elementLocated(By.xpath("//meta[@property='og:description']")),
                    10000
                );
                const content = await meta.getAttribute('content');
                if (content) {
                    // Format: "X Followers, Y Following, Z Posts"
                    const match = content.match(/([\d,KM]+)\s+Followers/);
                    if (match) {
                        return this.extractFollowerCount(match[1]);
                    }
                }
            } catch (error) {
                // Meta tag not found
            }
            
            // Try to find in page source
            const pageSource = await this.driver.getPageSource();
            let matches = pageSource.match(/"edge_followed_by":\{"count":(\d+)/);
            if (matches) {
                return parseInt(matches[1]);
            }
            
            // Try alternative patterns
            const patterns = [
                /"follower_count":(\d+)/,
                /(\d+(?:\.\d+)?[KM]?)\s+followers/i,
                /data-testid="followers"[^>]*>([^<]+)/
            ];
            
            for (const pattern of patterns) {
                matches = pageSource.match(pattern);
                if (matches) {
                    const count = this.extractFollowerCount(matches[1]);
                    if (count !== null && count > 0) {
                        return count;
                    }
                }
            }
            
            console.log('[WARN] Could not find Instagram follower count');
            return null;
            
        } catch (error) {
            console.error(`[ERROR] Error scraping Instagram: ${error.message}`);
            return null;
        } finally {
            await this.closeDriver();
        }
    }

    async checkExistingFollowerCount(competCompanyId) {
        try {
            const query = `
                SELECT INSTA_FOLLOWER_COUNT, UPDATE_DTM
                FROM SMP_FOLLOWERS 
                WHERE COMPET_COMPANY_ID = ? AND INSTA_FOLLOWER_COUNT IS NOT NULL
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                const count = results[0].INSTA_FOLLOWER_COUNT;
                const lastUpdated = results[0].UPDATE_DTM;
                console.log(`[INFO] Instagram follower count already exists: ${count} (last updated: ${lastUpdated})`);
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
            console.log(`[INFO] Scraping fresh Instagram data for competitor ${competCompanyId}`);
            
            // Get Instagram URL for the competitor company
            const { instaUrl, companyId } = await this.getInstagramUrl(competCompanyId);
            if (!instaUrl) {
                console.log(`[ERROR] No Instagram URL found for competitor ID: ${competCompanyId}`);
                return false;
            }
            
            console.log(`[INFO] Scraping Instagram followers for competitor ${competCompanyId}: ${instaUrl}`);
            
            // Scrape followers
            const count = await this.scrapeFollowers(instaUrl);
            if (count !== null) {
                // Update database
                const success = await this.updateFollowerCount(competCompanyId, companyId, count, instaUrl);
                if (success) {
                    console.log(`[RESULT] Instagram followers: ${count}`);
                    return true;
                } else {
                    console.log('[ERROR] Failed to update database');
                    return false;
                }
            } else {
                console.log('[RESULT] Failed to fetch Instagram followers.');
                return false;
            }
        } finally {
            await this.closeDb();
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log('Usage: node instagram_follower_count_v2.js <compet_company_id>');
        process.exit(1);
    }
    
    const competCompanyId = process.argv[2];
    
    // Run the scraper
    const scraper = new InstagramScraper();
    const success = await scraper.run(competCompanyId);
    
    // Return success/failure status
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = InstagramScraper;
