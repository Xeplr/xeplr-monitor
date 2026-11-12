// THE MONITOR'S ROUTES — at /api/monitor, behind createApp's auth gate.
//
//   GET    /settings                    the API's own unit (which it will not stop or kill)
//   GET    /host                        the server itself: memory, CPU, disks, uptime (the Home page)
//   GET    /services                    every watched service with its status and processes now
//   POST   /services                    { unit, label? } — watch one more
//   PATCH  /services/:unit              { label?, unit? } — changed in place
//   DELETE /services/:unit              stop watching it (the service is not touched)
//   POST   /services/:unit/:action      start | stop | restart | kill
//   GET    /services/:unit/logs         ?lines=&since=&until=&grep=&level= — oldest first
//   GET    /services/:unit/logs/live    the log as it is written (server-sent events)
//   GET    /audit                       ?limit= — who did what, newest first
//
// Each route checks its own permission (requireApi): the names are the `apis`
// rows in migrations-auth/0006_monitor.sql, granted to roles there. Every
// change is written to monitor_audit, refused ones included.
var express = require('express');
var { requireApi } = require('@xeplr/base-apis');
var systemd = require('../lib/systemd');
var services = require('../lib/services');
var host = require('../lib/host');

// The `apis` rows these routes are checked against — the same names as
// migrations-auth/0006_monitor.sql. Changing one here means changing it there.
var API = {
  settings: 'View monitor settings',
  host: 'View server statistics',
  list: 'List monitored services',
  logs: 'Read service logs',
  live: 'Follow service logs live',
  control: 'Start, stop, restart or kill a service',
  add: 'Add a monitored service',
  edit: 'Edit a monitored service',
  remove: 'Remove a monitored service',
  audit: 'Read the monitor audit log'
};

// How it asks systemd, read once at startup.
// MONITOR_CONTROL_COMMAND: the root-owned command sudoers allows (the deploy
// installs deploy/control.sh there); unset in development, where systemctl is
// asked directly.
systemd.configure({ sudo: process.env.MONITOR_SUDO || 'actions', control: process.env.MONITOR_CONTROL_COMMAND || null });

var LIVE_PER_USER = 10;
var HEARTBEAT_MS = 15000;

var router = express.Router();
var live = new Map(); // who -> open live logs

function who(req) { return (req.user && (req.user.email || req.user.id)) || 'unknown'; }
function ipOf(req) { return req.ip || (req.socket && req.socket.remoteAddress) || null; }

// An async handler: its result as JSON; its error to createApp's error handler ({ error }, its status).
function answer(fn) {
  return function(req, res, next) {
    Promise.resolve().then(function() { return fn(req, res); }).then(function(out) {
      if (!res.headersSent) res.json(out === undefined ? { ok: true } : out);
    }).catch(function(err) { if (!res.headersSent) next(err); });
  };
}

// A change, recorded in the audit log whether it worked or not.
function change(action, fn) {
  return answer(async function(req) {
    var unit = req.params.unit || (req.body && req.body.unit) || null;
    try {
      var out = await fn(req);
      await services.audit({ email: who(req), ip: ipOf(req), action: action, unit: (out && out.unit) || unit, ok: true });
      return out;
    } catch (err) {
      await services.audit({ email: who(req), ip: ipOf(req), action: action, unit: unit, ok: false, error: err.message });
      throw err;
    }
  });
}

async function unitOf(req) { return (await services.get(systemd.unitName(req.params.unit))).unit; }

router.get('/settings', requireApi(API.settings), function(req, res) {
  res.json({ self: systemd.selfUnit() });
});

router.get('/host', requireApi(API.host), function(req, res) {
  res.json(host.stats());
});

router.get('/services', requireApi(API.list), answer(async function() {
  var list = await services.all();
  var out = await Promise.all(list.map(async function(s) {
    var row = { unit: s.unit, label: s.label, addedBy: s.addedBy };
    try {
      var st = await systemd.status(s.unit);
      return Object.assign(row, { status: st, processes: systemd.processes(st) });
    } catch (e) { return Object.assign(row, { status: null, processes: [], statusError: e.message }); }
  }));
  systemd.forgetGone(new Set([].concat.apply([], out.map(function(s) { return s.processes.map(function(p) { return p.pid; }); }))));
  return out;
}));

router.post('/services', requireApi(API.add), change('add', function(req) { return services.add(req.body || {}, who(req)); }));
router.patch('/services/:unit', requireApi(API.edit), change('edit', async function(req) { return services.edit(await unitOf(req), req.body || {}); }));
router.delete('/services/:unit', requireApi(API.remove), change('remove', async function(req) { await services.remove(await unitOf(req)); return { unit: req.params.unit }; }));

// The action is part of what is recorded, so its handler is made per request.
router.post('/services/:unit/:action', requireApi(API.control), function(req, res, next) {
  var action = req.params.action;
  return change(action, async function() {
    if (systemd.ACTIONS.indexOf(action) < 0) { var e = new Error('Unknown action "' + action + '": start, stop, restart or kill'); e.status = 400; throw e; }
    var unit = await unitOf(req);
    if ((action === 'stop' || action === 'kill') && unit === systemd.selfUnit()) {
      var own = new Error('This is the monitor\'s own API: stopping it would leave nothing to start it again. Restart it instead'); own.status = 400; throw own;
    }
    return { unit: unit, status: await systemd.act(unit, action) };
  })(req, res, next);
});

router.get('/services/:unit/logs', requireApi(API.logs), answer(async function(req) {
  var q = req.query || {};
  return { lines: await systemd.logs(await unitOf(req), { lines: q.lines, since: q.since, until: q.until, grep: q.grep, level: q.level }) };
}));

// Server-sent events over a plain GET: the page reads it with fetch (it must
// send its sign-in token, which EventSource cannot), one `data:` line per log
// line. Closing the request ends the journalctl reading it.
router.get('/services/:unit/logs/live', requireApi(API.live), answer(async function(req, res) {
  var unit = await unitOf(req);
  var me = who(req);
  var open = live.get(me) || 0;
  if (open >= LIVE_PER_USER) { var e = new Error('You already have ' + LIVE_PER_USER + ' live logs open. Close one first'); e.status = 429; throw e; }
  live.set(me, open + 1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('event: ready\ndata: {}\n\n');
  var stop = systemd.follow(unit, function(line) {
    res.write('data: ' + JSON.stringify(line) + '\n\n');
  }, function(problem) {
    res.write('event: problem\ndata: ' + JSON.stringify({ error: problem }) + '\n\n');
  });
  var beat = setInterval(function() { res.write(': still here\n\n'); }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();
  var closed = false;
  req.on('close', function() {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    stop();
    live.set(me, Math.max((live.get(me) || 1) - 1, 0));
  });
}));

router.get('/audit', requireApi(API.audit), answer(async function(req) {
  return { entries: await services.recentAudit(req.query.limit) };
}));

router.API = API;
module.exports = router;
