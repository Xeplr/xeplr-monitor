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

// ── your data ────────────────────────────────────────────────────────────
//
// MOUNTED UNDER /api, and that prefix matters. The browser asks the UI's dev
// server for BOTH its own pages and its data, and the dev server decides by
// path which to forward. Serve data at /tasks and the UI's own /tasks page is
// shadowed by it — opening that page shows raw JSON instead of the app.
//
// Forms (tasks, and any made in Configure UI) need nothing here — @xeplr/factory
// serves them at /api/factory/..., mounted in app.js.
//
// A table you write by hand gets its four addresses from one line:
//
//   var { genericRoute } = require('@xeplr/base-apis');
//   router.use('/api/things', genericRoute({ key: 'thing', model: require('../models').Thing }));

// The monitor: the server's systemd services — their state, processes and
// logs, and start / stop / restart / kill (routes/monitor.js).
router.use('/api/monitor', require('./monitor'));

// Flows: @xeplr/workflow-api, at /api/workflow, running inside this API (see
// routes/flows.js and workflow.js).
router.use('/api/workflow', require('./flows'));

module.exports = router;
