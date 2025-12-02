const FollowerScrapingService = require('./FollowerScrapingService');

async function test() {
    console.log('Testing FollowerScrapingService with direct import...\n');
    
    const service = new FollowerScrapingService();
    
    console.log('Running Facebook scraper for competitor 674706...');
    const result = await service.runScraper('facebook', 674706);
    
    console.log('\nResult:');
    console.log(JSON.stringify(result, null, 2));
    
    process.exit(0);
}

test().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
