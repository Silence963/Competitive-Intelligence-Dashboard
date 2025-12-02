const { spawn } = require('child_process');
const path = require('path');

// Test spawning the facebook scraper
const scrapersPath = path.join(__dirname, 'scrappers');
const scraperPath = path.join(scrapersPath, 'facebook_follower_count_v2.js');
const testCompetitorId = '674706'; // From user's log

console.log('[Test] Starting spawn test...');
console.log('[Test] Node path:', process.execPath);
console.log('[Test] Scraper path:', scraperPath);
console.log('[Test] Competitor ID:', testCompetitorId);
console.log('[Test] CWD will be:', scrapersPath);
console.log('');

const nodeProcess = spawn('node', [scraperPath, testCompetitorId], {
    cwd: scrapersPath,
    stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

console.log('[Test] Process spawned with PID:', nodeProcess.pid);

nodeProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    console.log('[STDOUT]', chunk);
    stdout += chunk;
});

nodeProcess.stderr.on('data', (data) => {
    const chunk = data.toString();
    console.log('[STDERR]', chunk);
    stderr += chunk;
});

nodeProcess.on('error', (error) => {
    console.error('[ERROR] Failed to spawn:', error);
});

nodeProcess.on('close', (code) => {
    console.log('');
    console.log('[Test] Process exited with code:', code);
    console.log('[Test] Full stdout length:', stdout.length);
    console.log('[Test] Full stderr length:', stderr.length);
    console.log('');
    console.log('=== FULL STDOUT ===');
    console.log(stdout);
    console.log('');
    console.log('=== FULL STDERR ===');
    console.log(stderr);
    console.log('');
    
    // Try the regex matching
    const resultMatch = stdout.match(/\[RESULT\] .* followers.*?(\d+)/);
    const cachedMatch = stdout.match(/\[RESULT\] .* followers \(cached\): (\d+)/);
    
    console.log('[Test] Result match:', resultMatch);
    console.log('[Test] Cached match:', cachedMatch);
    
    if (resultMatch) {
        console.log('[Test] SUCCESS - Extracted follower count:', parseInt(resultMatch[1]));
    } else if (cachedMatch) {
        console.log('[Test] SUCCESS - Extracted cached follower count:', parseInt(cachedMatch[1]));
    } else {
        console.log('[Test] FAILED - Could not parse follower count from output');
    }
});
