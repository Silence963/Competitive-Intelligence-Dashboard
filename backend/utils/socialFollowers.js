// backend/utils/socialFollowers.js
// Utility to run social media follower scrapers and return counts
const { spawn } = require('child_process');
const path = require('path');


async function runPythonScraper(script, url) {
  return new Promise((resolve, reject) => {
    // Only use the filename, always resolve from scrappers directory
    const scriptFile = path.basename(script);
    const scriptPath = path.resolve(__dirname, '..', 'scrappers', scriptFile);
    console.log(`[SCRAPER] Starting: ${scriptPath} for URL: ${url}`);
    const py = spawn('python', [scriptPath, url]);
    let output = '';
    let error = '';
    py.stdout.on('data', (data) => {
      const msg = data.toString();
      output += msg;
      process.stdout.write(`[SCRAPER][stdout][${scriptFile}]: ${msg}`);
    });
    py.stderr.on('data', (data) => {
      const msg = data.toString();
      error += msg;
      process.stderr.write(`[SCRAPER][stderr][${scriptFile}]: ${msg}`);
    });
    py.on('close', (code) => {
      if (code === 0) {
        const count = parseInt(output.trim().replace(/\D/g, ''));
        console.log(`[SCRAPER] Finished: ${scriptFile} | Result: ${isNaN(count) ? 'N/A' : count}`);
        resolve(isNaN(count) ? 0 : count);
      } else {
        console.error(`[SCRAPER] Failed: ${scriptFile} | Exit code: ${code} | Error: ${error}`);
        reject(new Error(error || 'Scraper failed'));
      }
    });
  });
}


async function getAllFollowers({ fbUrl, instaUrl, linkedinUrl }) {
  const results = {};
  try {
    if (fbUrl) {
      console.log('[SCRAPER] Fetching Facebook followers...');
      results.FB_FOLLOWER_COUNT = await runPythonScraper(
        'facebook_follower_count.py', fbUrl
      );
    }
    if (instaUrl) {
      console.log('[SCRAPER] Fetching Instagram followers...');
      results.INSTA_FOLLOWER_COUNT = await runPythonScraper(
        'instagram_follower_count_linux_sb_v2.py', instaUrl
      );
    }
    if (linkedinUrl) {
      console.log('[SCRAPER] Fetching LinkedIn followers...');
      results.LINKEDIN_FOLLOWER_COUNT = await runPythonScraper(
        'linkdin_follower_count_linux_sb_v3.py', linkedinUrl
      );
    }
    console.log('[SCRAPER] All results:', results);
  } catch (err) {
    console.error('[SCRAPER] Error running social follower scraper:', err);
  }
  return results;
}

module.exports = { getAllFollowers };
