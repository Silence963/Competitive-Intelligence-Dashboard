const path = require('path');
const { spawnSync } = require('child_process');

class FollowerScrapingService {
    constructor() {
        this.scrapersPath = path.join(__dirname, 'scrappers');
        this.scrapers = {
            facebook: 'facebook_follower_count_v2.js',
            instagram: 'instagram_follower_count_v2.js', 
            linkedin: 'linkedin_follower_count_v2.js'
        };
    }

    /**
     * Run a specific scraper for a competitor
     */
    async runScraper(platform, competitorId) {
        const scraperFile = this.scrapers[platform];
        
        if (!scraperFile) {
            return {
                success: false,
                platform,
                competitorId,
                error: 'Unknown platform'
            };
        }
        
        console.log(`\n[FollowerService] Running ${platform} scraper for competitor ${competitorId}`);
        
        try {
            // 1. Get the exact Node executable currently running
            const nodeExecutable = process.execPath;
            
            // 2. Build the ABSOLUTE path to the scraper script
            const scriptPath = path.resolve(__dirname, 'scrappers', scraperFile);
            
            console.log(`[FollowerService] Node: ${nodeExecutable}`);
            console.log(`[FollowerService] Script: ${scriptPath}`);
            console.log(`[FollowerService] CWD: ${__dirname}`);
            console.log(`[FollowerService] Command: ${nodeExecutable} ${scriptPath} ${competitorId}`);

            // 3. Execute with CRITICAL fix for Selenium hanging
            const result = spawnSync(nodeExecutable, [scriptPath, competitorId], {
                cwd: __dirname,             // Run from backend directory (matches manual execution)
                
                // CRITICAL FIX HERE:
                // 'ignore' for stdin prevents Selenium from waiting for input
                // 'inherit' for stdout/stderr lets you see the logs
                stdio: ['ignore', 'inherit', 'inherit'], 
                
                env: process.env,           // Pass path variables so it finds Chrome
                shell: false                // Better security/stability
            });
            
            if (result.error) {
                throw result.error;
            }
            
            if (result.status === 0) {
                console.log(`[FollowerService] ✅ ${platform} scraper completed successfully\n`);
                return {
                    success: true,
                    platform,
                    competitorId
                };
            } else {
                console.error(`[FollowerService] ❌ ${platform} scraper exited with code ${result.status}\n`);
                return {
                    success: false,
                    platform,
                    competitorId,
                    error: `Scraper exited with code ${result.status}`
                };
            }
        } catch (error) {
            console.error(`[FollowerService] ❌ ${platform} scraper failed: ${error.message}\n`);
            
            return {
                success: false,
                platform,
                competitorId,
                error: error.message
            };
        }
    }

    async scrapeCompetitors(competitorIds) {
        if (!competitorIds || competitorIds.length === 0) {
            return { 
                success: true, 
                message: 'No competitors to scrape',
                results: []
            };
        }

        const results = [];
        const platforms = ['facebook', 'instagram', 'linkedin'];

        for (const competitorId of competitorIds) {
            console.log(`\n========== Scraping competitor ${competitorId} ==========`);
            const platformResults = [];
            
            for (const platform of platforms) {
                const result = await this.runScraper(platform, competitorId);
                platformResults.push(result);
            }
            
            results.push({
                competitorId,
                platforms: platformResults
            });
            console.log(`========== Completed competitor ${competitorId} ==========\n`);
        }

        const totalSuccess = results.reduce((count, comp) => 
            count + comp.platforms.filter(p => p.success).length, 0
        );
        const totalFailed = results.reduce((count, comp) => 
            count + comp.platforms.filter(p => !p.success).length, 0
        );

        console.log(`\n[FollowerService] FINAL: ${totalSuccess} succeeded, ${totalFailed} failed\n`);

        return {
            success: true,
            summary: {
                totalCompetitors: competitorIds.length,
                totalSuccess,
                totalFailed
            },
            results
        };
    }

    async ensureFollowerData(companyId, competitorIds = []) {
        if (competitorIds.length === 0) {
            console.log('[FollowerService] No competitors to scrape');
            return {
                success: true,
                message: 'No competitors to scrape',
                summary: { totalCompetitors: 0, totalSuccess: 0, totalFailed: 0 }
            };
        }

        console.log(`\n[FollowerService] Starting scraping for ${competitorIds.length} competitors\n`);
        return await this.scrapeCompetitors(competitorIds);
    }
}

module.exports = FollowerScrapingService;