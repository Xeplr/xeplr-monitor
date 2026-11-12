// THE MONITOR'S API — mounted at /api by bin/server.js (or by a host).
//
//   POST   /login                      { email, password, code? } → the user, and the cookie
//   POST   /logout
//   GET    /me                         who is signed in, and what may be added
//   GET    /services                   every watched service with its status and processes now
//   POST   /services                   { unit, label? } — watch one more
//   PATCH  /services/:unit             { label?, unit? } — changed in place
//   DELETE /services/:unit             stop watching it (the service is not touched)
//   POST   /services/:unit/:action     start | stop | restart | kill
//   GET    /services/:unit/logs        ?lines=&since=&until=&grep=&level= — oldest first
//   GET    /services/:unit/logs/live   the log as it is written (server-sent events)
//   GET    /audit                      ?limit= — who did what, newest first
//
// Everything but /login needs a signed-in user (lib/session.js); a change also
// needs the x-xeplr-monitor: 1 header. Every sign-in and every change goes to
// the audit log, refused ones included. Bodies are parsed, and errors answered
// as { error }, by @xeplr/base-apis createApp, which this is mounted in.
var express = require('express');
var RateLimiter = require('@xeplr/utils/lib/rateLimiter');
var session = require('./session');
var users = require('./users');
var services = require('./services');
var systemd = require('./systemd');
var store = require('./store');

var LIVE_PER_USER = 10;
// Wrong sign-ins: 5 for one email, or 20 from one address (any emails; several
// people share an office network), within 15 minutes, lock it until the 15
// minutes from the first are up. In memory: a restart clears it, which only
// ever helps whoever restarted it.
var LOCK_SECONDS = 15 * 60;
var FAILS = 5;
var FAILS_PER_ADDRESS = 20;
var HEARTBEAT_MS = 15000;

function createRouter() {
  var r = express.Router();
  var live = new Map(); // email -> open live logs
  var perEmail = new RateLimiter({ windowInSeconds: LOCK_SECONDS, max: FAILS });
  var perAddress = new RateLimiter({ windowInSeconds: LOCK_SECONDS, max: FAILS_PER_ADDRESS });

  // An async handler: its result as JSON; its error to createApp's error handler ({ error }, its status).
  function answer(fn) {
    return function(req, res, next) {
      Promise.resolve().then(function() { return fn(req, res); }).then(function(out) {
        if (!res.headersSent) res.json(out === undefined ? { ok: true } : out);
      }).catch(function(err) {
        if (!res.headersSent) next(err);
      });
    };
  }
  function ipOf(req) { return req.ip || (req.socket && req.socket.remoteAddress) || null; }
  function unitOf(req) { return services.get(systemd.unitName(req.params.unit)).unit; }

  r.post('/login', answer(async function(req, res) {
    var b = req.body || {};
    var email = String(b.email || '').trim().toLowerCase();
    var byEmail = 'monitor:email:' + email;
    var byAddress = 'monitor:ip:' + ipOf(req);
    var wait = Math.max(await perEmail.lockedFor(byEmail), await perAddress.lockedFor(byAddress));
    if (wait) {
      store.audit({ email: email, ip: ipOf(req), action: 'sign-in', ok: false, error: 'locked' });
      var minutes = Math.ceil(wait / 60);
      res.status(429).json({ error: 'Too many wrong tries. Try again in ' + minutes + ' minute' + (minutes === 1 ? '' : 's') });
      return;
    }
    var out = users.check(email, b.password, b.code);
    if (!out.user) {
      // Asking for the code is not a wrong try; a wrong code is.
      if (!(out.needsCode && !b.code)) {
        await perEmail.fail(byEmail);
        await perAddress.fail(byAddress);
        store.audit({ email: email, ip: ipOf(req), action: 'sign-in', ok: false, error: out.problem });
      }
      res.status(401).json({ error: out.problem, needsCode: Boolean(out.needsCode) });
      return;
    }
    await perEmail.reset(byEmail);
    session.start(req, res, out.user);
    store.audit({ email: out.user.email, ip: ipOf(req), action: 'sign-in', ok: true });
    return { user: users.shown(out.user) };
  }));

  r.post('/logout', function(req, res) {
    var u = session.read(session.cookieOf(req));
    session.end(req, res);
    if (u) store.audit({ email: u.email, ip: ipOf(req), action: 'sign-out', ok: true });
    res.json({ ok: true });
  });

  r.use(session.required);

  r.get('/me', function(req, res) {
    res.json({ user: users.shown(req.user), allowed: services.allowedPatterns(), self: systemd.selfUnit() });
  });

  r.get('/services', answer(async function() {
    var list = services.all();
    var out = await Promise.all(list.map(async function(s) {
      try {
        var st = await systemd.status(s.unit);
        return Object.assign({}, s, { status: st, processes: systemd.processes(st) });
      } catch (e) { return Object.assign({}, s, { status: null, processes: [], statusError: e.message }); }
    }));
    systemd.forgetGone(new Set([].concat.apply([], out.map(function(s) { return s.processes.map(function(p) { return p.pid; }); }))));
    return out;
  }));

  // A change, recorded whether it worked or not.
  function change(action, fn) {
    return answer(async function(req) {
      var unit = req.params.unit || (req.body && req.body.unit) || null;
      try {
        var out = await fn(req);
        store.audit({ email: req.user.email, ip: ipOf(req), action: action, unit: (out && out.unit) || unit, ok: true });
        return out;
      } catch (err) {
        store.audit({ email: req.user.email, ip: ipOf(req), action: action, unit: unit, ok: false, error: err.message });
        throw err;
      }
    });
  }

  r.post('/services', change('add', function(req) { return services.add(req.body || {}, req.user.email); }));
  r.patch('/services/:unit', change('edit', function(req) { return services.edit(unitOf(req), req.body || {}, req.user.email); }));
  r.delete('/services/:unit', change('remove', function(req) { services.remove(unitOf(req)); return { unit: req.params.unit }; }));

  // The action is part of what is recorded, so its handler is made per request.
  r.post('/services/:unit/:action', function(req, res, next) {
    var action = req.params.action;
    return change(action, async function() {
      if (systemd.ACTIONS.indexOf(action) < 0) { var e = new Error('Unknown action "' + action + '": start, stop, restart or kill'); e.status = 400; throw e; }
      var unit = unitOf(req);
      if ((action === 'stop' || action === 'kill') && unit === systemd.selfUnit()) {
        var own = new Error('This is the monitor itself: stopping it would leave nothing to start it again. Restart it instead'); own.status = 400; throw own;
      }
      return { unit: unit, status: await systemd.act(unit, action) };
    })(req, res, next);
  });

  r.get('/services/:unit/logs', answer(async function(req) {
    var q = req.query || {};
    return { lines: await systemd.logs(unitOf(req), { lines: q.lines, since: q.since, until: q.until, grep: q.grep, level: q.level }) };
  }));

  r.get('/services/:unit/logs/live', function(req, res) {
    var unit;
    try { unit = unitOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    var open = live.get(req.user.email) || 0;
    if (open >= LIVE_PER_USER) return res.status(429).json({ error: 'You already have ' + LIVE_PER_USER + ' live logs open. Close one first' });
    live.set(req.user.email, open + 1);
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
      live.set(req.user.email, Math.max((live.get(req.user.email) || 1) - 1, 0));
    });
  });

  r.get('/audit', function(req, res) {
    res.json({ entries: store.recentAudit(Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 2000)) });
  });

  return r;
}

module.exports = { createRouter: createRouter, FAILS: FAILS, FAILS_PER_ADDRESS: FAILS_PER_ADDRESS };
