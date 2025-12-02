const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuration for the database connection
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000, // 10 seconds
  acquireTimeout: 10000, // 10 seconds
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 seconds
  // Character set configuration to handle encoding issues
  charset: 'latin1',
  collation: 'latin1_swedish_ci',
  // Enable reconnection
  reconnect: true,
  // Maximum number of reconnection attempts
  reconnectTries: 3,
  // Delay between reconnection attempts (ms)
  reconnectDelay: 1000,
  // Time after which to consider a connection as dead (ms)
  connectTimeout: 60000
};

// Create a connection pool with enhanced error handling
let pool;

async function createPool() {
  try {
    pool = mysql.createPool(dbConfig);
    
    // Add event listeners for connection errors
    pool.on('error', async (err) => {
      console.error('Database pool error:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Database connection was closed. Reconnecting...');
        await createPool();
      }
    });
    
    // Test the connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    console.log('✅ Database pool created successfully');
    return pool;
  } catch (error) {
    console.error('❌ Failed to create database pool:', error.message);
    throw error;
  }
}

// Initialize the pool
createPool().catch(err => {
  console.error('Failed to initialize database pool:', err);
  process.exit(1);
});

// Test the database connection
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✅ Successfully connected to the database');
    return true;
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    return false;
  } finally {
    if (connection) connection.release();
  }
}

// Helper function to execute a query with retry logic
async function executeWithRetry(operation, maxRetries = 3, retryDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // If it's a connection error and not the last attempt, try to reconnect
      if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST') {
        console.warn(`⚠️ Connection lost, retrying (${attempt}/${maxRetries})...`);
        
        try {
          // Try to get a new connection
          const connection = await pool.getConnection();
          await connection.ping();
          connection.release();
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } catch (reconnectError) {
          console.error('❌ Failed to reconnect to database:', reconnectError.message);
        }
      }
      
      // For other errors or if reconnection failed, break the loop
      break;
    }
  }
  
  // If we got here, all retries failed
  throw lastError;
}

// Export the pool and test function
module.exports = {
  pool: {
    ...pool,
    // Override the query method to include retry logic
    query: async (sql, params) => {
      return executeWithRetry(() => pool.query(sql, params));
    },
    // Override the execute method to include retry logic
    execute: async (sql, params) => {
      return executeWithRetry(() => pool.execute(sql, params));
    },
    // Override the getConnection method to include retry logic
    getConnection: async () => {
      return executeWithRetry(() => pool.getConnection());
    }
  },
  
  testConnection,
  
  // Add a query helper function for convenience with retry logic
  query: async (sql, params) => {
    const [rows] = await executeWithRetry(() => pool.query(sql, params));
    return rows;
  },
  
  // Add a queryOne helper function for single row results with retry logic
  queryOne: async (sql, params) => {
    const [rows] = await executeWithRetry(() => pool.query(sql, params));
    return rows[0];
  },
  
  // Add an execute helper function for INSERT/UPDATE/DELETE with retry logic
  execute: async (sql, params) => {
    const [result] = await executeWithRetry(() => pool.execute(sql, params));
    return result;
  },
  // Add getRows for backward compatibility
  getRows: async (query, params = []) => {
    const [rows] = await pool.query(query, params);
    return rows;
  },
  // Add getRow for backward compatibility
  getRow: async (query, params = []) => {
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  },
  // Add executeQuery for backward compatibility
  executeQuery: async (query, params = []) => {
    const [result] = await pool.execute(query, params);
    return result;
  }
};

// Test the connection when this module is loaded
testConnection().then(success => {
  if (!success) {
    console.error('❌ Failed to connect to the database. Please check your .env file and database settings.');
  }
});
