var express = require('express');

var router = express.Router();

// PUBLIC — listed in app.js's auth.publicPaths. Whatever polls this has never
// signed in, so it has no token to send. It reports liveness and nothing else.
router.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

// GATED, like everything not named public.
router.get('/', function(req, res) {
  res.json({ service: 'api', status: 'running', name: 'xeplr-monitor-api' });
});

// Who is calling, and what they are allowed to reach. Both were put on the
// request by the auth gate, so this makes no call of its own.
router.get('/whoami', function(req, res) {
  res.json({ user: req.user, roles: (req.access || {}).roles || [] });
});

// ── the monitor ──────────────────────────────────────────────────────────
//
// MOUNTED UNDER /api, and that prefix matters: the UI's dev server forwards
// /api to this API and serves every other path as a page.
//
// The server's services — their state, processes and logs, and start / stop /
// restart / kill (routes/monitor.js).
// The logins the backups use (@xeplr/backups' router): the Backup connections
// page and the jobs' dropdowns. Each route checked by this app's requireApi;
// each change in the monitor's audit log, by the connection's name.
var { requireApi } = require('@xeplr/base-apis');
var services = require('../lib/services');
router.use('/api/monitor/connections', require('@xeplr/backups').router({
  requireApi: requireApi,
  audit: function(e) { return services.audit({ email: e.email, ip: e.ip, action: e.action, unit: 'connection: ' + e.name, ok: e.ok, error: e.error }); }
}));
router.use('/api/monitor', require('./monitor'));

// The backup jobs (@xeplr/jobs, lib/jobs.js): /api/jobs, /api/job-occurrences,
// /api/actions — the Jobs page of @xeplr/ui-jobs. Each operation checked
// against jobs' own apis rows (node_modules/@xeplr/jobs/migrations-auth).
router.use('/api', require('@xeplr/jobs').router({
  auth: { list: requireApi('List jobs'), getById: requireApi('Get job'), save: requireApi('Save job'), delete: requireApi('Delete job') }
}));

module.exports = router;
