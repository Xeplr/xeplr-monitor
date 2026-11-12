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
router.use('/api/monitor', require('./monitor'));

module.exports = router;
