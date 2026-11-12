var createApp = require('@xeplr/base-apis/express');
var factory = require('@xeplr/factory');
var routes = require('./routes');
var access = require('./routes/access');

// Every screen route first checks the caller may use the request's
// data (no tenancy: nothing to check).
var memberGate = access.anyone;

// No `|| 19402` fallback — the port is required in env.required.js, so a
// default could only ever fire in a process that skipped that check.
var port = process.env.XEPLR_MONITOR_PORT;

module.exports = buildApp;
// bin/www hands the same gate to the flows router it starts (workflow.js).
module.exports.memberGate = memberGate;

function buildApp(extraRoutes) {
  return createApp(port, 'xeplr-monitor_api', {
    // Every route needs a valid token, checked against the auth service at
    // AUTH_URL. This app names no `middleware` of its own — it takes the
    // framework's gate rather than writing one.
    auth: {
      // The only exception, and it earns it: a health check has no token to
      // send. Prefixes, so '/health' also covers '/health/anything'.
      publicPaths: ['/health']
    },
    log: { logDir: process.env.LOG_DIR || './logs' },
    routes: Object.assign({}, extraRoutes || {}, {
      '/': routes,

      // THE SCREENS — every form, one set of routes:
      //   /api/factory/screens/...   designs: load, save draft, publish
      //   /api/factory/records/...   a screen's records: list, one, save, delete
      //
      // access: true — each route answers only a caller whose permissions name
      // it ("Save factory record", "Publish factory screen", ...). Granted to
      // Super Admin and CompanyAdmin (everything), Creator (use the screens) and
      // Viewer (read) by node_modules/@xeplr/factory/migrations-auth.
      '/api': factory.router({
        access: true,
        auth: {
          view: memberGate,
          write: memberGate,
          // Designing, new forms and publishing change tables: Super Admin
          // only (routes/access.js).
          design: [memberGate, access.superAdminOnly]
        }
      })
    })
  });
}
