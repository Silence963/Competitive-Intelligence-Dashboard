const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * Get database configuration from environment variables
 */
function getDbConfig() {
    return {
        host: process.env.DB_HOST || '88.150.227.117',
        user: process.env.DB_USER || 'nrktrn_web_admin',
        password: process.env.DB_PASSWORD || 'GOeg&*$*657',
        database: process.env.DB_NAME || 'nrkindex_trn',
        port: parseInt(process.env.DB_PORT || '3306'),
        charset: 'utf8mb4',
        connectTimeout: 10000,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
}

/**
 * Create and return a database connection
 */
async function getDbConnection() {
    try {
        const connection = await mysql.createConnection(getDbConfig());
        return connection;
    } catch (error) {
        console.error(`Error connecting to MySQL: ${error.message}`);
        throw error;
    }
}

/**
 * Execute a database query with parameters
 * @param {string} query - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @param {Object} options - Options for query execution
 * @returns {Promise} Query result
 */
async function executeQuery(query, params = [], options = {}) {
    let connection;
    
    try {
        connection = await getDbConnection();
        const [results] = await connection.execute(query, params);
        
        if (options.fetchOne) {
            return results[0] || null;
        }
        
        if (options.commit) {
            return results.insertId;
        }
        
        return results;
        
    } catch (error) {
        console.error(`Database error: ${error.message}`);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

module.exports = {
    getDbConfig,
    getDbConnection,
    executeQuery
};
