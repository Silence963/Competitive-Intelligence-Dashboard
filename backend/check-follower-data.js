const mysql = require('mysql2/promise');

async function checkFollowerData() {
    const connection = await mysql.createConnection({
        host: '88.150.227.117',
        user: 'nrktrn_web_admin',
        password: 'GOeg&*$*657',
        database: 'nrkindex_trn'
    });

    console.log('[Check] Checking follower data for competitor 674706...\n');

    // Check SMP_FOLLOWERS table
    const [followers] = await connection.query(
        `SELECT COMPANY_ID, COMPET_COMPANY_ID, FB_FOLLOWER_COUNT, INSTA_FOLLOWER_COUNT, 
                LINKEDIN_FOLLOWER_COUNT, UPDATE_DATE
         FROM SMP_FOLLOWERS 
         WHERE COMPET_COMPANY_ID = ?
         ORDER BY UPDATE_DATE DESC
         LIMIT 1`,
        [674706]
    );

    console.log('=== SMP_FOLLOWERS Data ===');
    if (followers.length > 0) {
        console.log('COMPANY_ID:', followers[0].COMPANY_ID);
        console.log('COMPET_COMPANY_ID:', followers[0].COMPET_COMPANY_ID);
        console.log('Facebook Followers:', followers[0].FB_FOLLOWER_COUNT);
        console.log('Instagram Followers:', followers[0].INSTA_FOLLOWER_COUNT);
        console.log('LinkedIn Followers:', followers[0].LINKEDIN_FOLLOWER_COUNT);
        console.log('Last Updated:', followers[0].UPDATE_DATE);
    } else {
        console.log('No data found for competitor 674706');
    }
    console.log('');

    // Check COMPA_COMPETITORS for URLs
    const [competitor] = await connection.query(
        `SELECT COMPET_COMPANY_ID, FB_URL, INSTA_URL, LINKEDIN_URL
         FROM COMPA_COMPETITORS 
         WHERE COMPET_COMPANY_ID = ?`,
        [674706]
    );

    console.log('=== COMPA_COMPETITORS URLs ===');
    if (competitor.length > 0) {
        console.log('Facebook URL:', competitor[0].FB_URL || 'Not set');
        console.log('Instagram URL:', competitor[0].INSTA_URL || 'Not set');
        console.log('LinkedIn URL:', competitor[0].LINKEDIN_URL || 'Not set');
    } else {
        console.log('No competitor record found');
    }

    await connection.end();
}

checkFollowerData().catch(console.error);
