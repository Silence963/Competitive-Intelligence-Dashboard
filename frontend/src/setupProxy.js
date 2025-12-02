const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5600',
      changeOrigin: true,
      // Optional: Add these if you need to handle WebSocket connections
      // ws: true,
      // pathRewrite: {
      //   '^/api': '', // Remove /api prefix when forwarding
      // },
      // onProxyReq: (proxyReq, req, res) => {
      //   // Optional: Add custom headers or logging
      //   console.log('Proxying request to:', req.originalUrl);
      // }
    })
  );
};
