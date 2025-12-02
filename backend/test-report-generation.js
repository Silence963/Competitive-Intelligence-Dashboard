const http = require('http');

// Test report generation with known company and competitor IDs
const companyId = 674704; // From user's previous log
const competitorIds = [674706]; // Facebook scraper worked with this ID

const postData = JSON.stringify({
    companyId: companyId,
    competitorIds: competitorIds,
    userid: 1481,
    firmid: 5
});

const options = {
    hostname: 'localhost',
    port: 5600,
    path: '/api/generate-competitor-analysis',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log('[Test] Triggering report generation...');
console.log('[Test] Company ID:', companyId);
console.log('[Test] Competitor IDs:', competitorIds);
console.log('');

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('[Test] Response Status:', res.statusCode);
        console.log('[Test] Response Headers:', JSON.stringify(res.headers, null, 2));
        console.log('');
        console.log('[Test] Response Body:');
        try {
            const parsed = JSON.parse(data);
            console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.log(data);
        }
    });
});

req.on('error', (error) => {
    console.error('[Test] Request failed:', error);
});

req.write(postData);
req.end();

console.log('[Test] Request sent. Check the server logs for scraper activity...');
console.log('');
