var createApp = require('@xeplr/base-apis/express');
var routes = require('./routes');

// No `|| 19402` fallback — the port is required in env.required.js, so a
// default could only ever fire in a process that skipped that check.
var port = process.env.XEPLR_MONITOR_PORT;

module.exports = buildApp;

function buildApp(extraRoutes) {
  return createApp(port, 'xeplr-monitor_api', {
    // Every route needs a valid token, checked against the auth service at
    // AUTH_URL. This app names no `middleware` of its own — it takes the
    // framework's gate rather than writing one. Each monitor route then checks
    // its own permission (requireApi, routes/monitor.js).
    auth: {
      // The only exception, and it earns it: a health check has no token to
      // send. Prefixes, so '/health' also covers '/health/anything'.
      publicPaths: ['/health']
    },
    // Absolute in production (the deploy sets it); ./logs only in development.
    log: { logDir: process.env.LOG_DIR || './logs' },
    routes: Object.assign({}, extraRoutes || {}, { '/': routes })
  });
}
