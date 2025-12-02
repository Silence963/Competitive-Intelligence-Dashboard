const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { By, until } = require('selenium-webdriver');
const mysql = require('mysql2/promise');

class LinkedInScraper {
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

    async getLinkedInUrl(competCompanyId) {
        try {
            const query = `
                SELECT LINKEDIN_URL, COMPANY_ID
                FROM COMPA_COMPETITORS 
                WHERE COMPET_COMPANY_ID = ? AND LINKEDIN_URL IS NOT NULL AND LINKEDIN_URL != ''
                LIMIT 1
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                return {
                    linkedinUrl: results[0].LINKEDIN_URL,
                    companyId: results[0].COMPANY_ID
                };
            }
            return { linkedinUrl: null, companyId: null };
        } catch (error) {
            console.error(`[ERROR] Failed to fetch LinkedIn URL: ${error.message}`);
            return { linkedinUrl: null, companyId: null };
        }
    }

    async updateFollowerCount(competCompanyId, companyId, followerCount, linkedinUrl) {
        try {
            // Check if record exists
            const checkQuery = 'SELECT ID FROM SMP_FOLLOWERS WHERE COMPET_COMPANY_ID = ?';
            const [existing] = await this.connection.execute(checkQuery, [competCompanyId]);
            
            if (existing.length > 0) {
                // Update existing record
                const updateQuery = `
                    UPDATE SMP_FOLLOWERS 
                    SET LINKEDIN_FOLLOWER_COUNT = ?, LINKEDIN_PAGE_URL = ?, UPDATE_DTM = NOW()
                    WHERE COMPET_COMPANY_ID = ?
                `;
                await this.connection.execute(updateQuery, [followerCount, linkedinUrl, competCompanyId]);
            } else {
                // Insert new record
                const insertQuery = `
                    INSERT INTO SMP_FOLLOWERS 
                    (COMPANY_ID, COMPET_COMPANY_ID, LINKEDIN_FOLLOWER_COUNT, LINKEDIN_PAGE_URL, STATUS, ISNRT_DTM, UPDATE_DTM)
                    VALUES (?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
                `;
                await this.connection.execute(insertQuery, [companyId, competCompanyId, followerCount, linkedinUrl]);
            }
            
            console.log(`[DB] Successfully updated LinkedIn followers for competitor ${competCompanyId}: ${followerCount}`);
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
            console.log(`[INFO] Loading LinkedIn page: ${url}`);
            await this.driver.get(url);
            
            // Wait for page to load
            await this.driver.sleep(10000);
            
            // Try multiple approaches to find follower count
            const selectors = [
                '.org-top-card-summary-info-list__info-item',
                '.follower-count',
                '[data-test-id="follower-count"]',
                '.org-top-card__follower-count',
                '.top-card-layout__entity-info .follower-count'
            ];
            
            for (const selector of selectors) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    for (const element of elements) {
                        const text = await element.getText();
                        const trimmedText = text.trim();
                        if (/follower|employee/i.test(trimmedText)) {
                            const count = this.extractFollowerCount(trimmedText);
                            if (count !== null) {
                                return count;
                            }
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // Try looking in page source
            const pageSource = await this.driver.getPageSource();
            
            // Look for patterns in LinkedIn page source
            const patterns = [
                /"followerCount":(\d+)/,
                /(\d+(?:\.\d+)?[KM]?)\s+followers/i,
                /(\d+(?:,\d{3})*)\s+followers/i,
                /"staffCount":(\d+)/
            ];
            
            for (const pattern of patterns) {
                const matches = pageSource.match(pattern);
                if (matches) {
                    const count = this.extractFollowerCount(matches[1]);
                    if (count !== null && count > 0) {
                        return count;
                    }
                }
            }
            
            console.log('[WARN] Could not find LinkedIn follower count');
            return null;
            
        } catch (error) {
            console.error(`[ERROR] Error scraping LinkedIn: ${error.message}`);
            return null;
        } finally {
            await this.closeDriver();
        }
    }

    async checkExistingFollowerCount(competCompanyId) {
        try {
            const query = `
                SELECT LINKEDIN_FOLLOWER_COUNT, UPDATE_DTM
                FROM SMP_FOLLOWERS 
                WHERE COMPET_COMPANY_ID = ? AND LINKEDIN_FOLLOWER_COUNT IS NOT NULL
            `;
            
            const [results] = await this.connection.execute(query, [competCompanyId]);
            
            if (results.length > 0) {
                const count = results[0].LINKEDIN_FOLLOWER_COUNT;
                const lastUpdated = results[0].UPDATE_DTM;
                console.log(`[INFO] LinkedIn follower count already exists: ${count} (last updated: ${lastUpdated})`);
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
            console.log(`[INFO] Scraping fresh LinkedIn data for competitor ${competCompanyId}`);
            
            // Get LinkedIn URL for the competitor company
            const { linkedinUrl, companyId } = await this.getLinkedInUrl(competCompanyId);
            if (!linkedinUrl) {
                console.log(`[ERROR] No LinkedIn URL found for competitor ID: ${competCompanyId}`);
                return false;
            }
            
            console.log(`[INFO] Scraping LinkedIn followers for competitor ${competCompanyId}: ${linkedinUrl}`);
            
            // Scrape followers
            const count = await this.scrapeFollowers(linkedinUrl);
            if (count !== null) {
                // Update database
                const success = await this.updateFollowerCount(competCompanyId, companyId, count, linkedinUrl);
                if (success) {
                    console.log(`[RESULT] LinkedIn followers: ${count}`);
                    return true;
                } else {
                    console.log('[ERROR] Failed to update database');
                    return false;
                }
            } else {
                console.log('[RESULT] Failed to fetch LinkedIn followers.');
                return false;
            }
        } finally {
            await this.closeDb();
        }
    }
}

async function main() {
    if (process.argv.length < 3) {
        console.log('Usage: node linkedin_follower_count_v2.js <compet_company_id>');
        process.exit(1);
    }
    
    const competCompanyId = process.argv[2];
    
    // Run the scraper
    const scraper = new LinkedInScraper();
    const success = await scraper.run(competCompanyId);
    
    // Return success/failure status
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = LinkedInScraper;
