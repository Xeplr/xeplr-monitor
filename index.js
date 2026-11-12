// @xeplr/monitor — see and control a server's services: status, start, stop,
// restart, kill, and their logs, live. Its own sign-in, its own files, no
// database: it is what you open when something else is down.
//
// Built on @xeplr/base-apis createApp (the gate, cookies, request lines through
// @xeplr/logs to stdout, so to the journal; 404 and errors) and @xeplr/utils (authenticator codes, the
// wrong-try lockout). Neither needs Redis or a database here.
//
//   init(config)    open the store, the secret, the allowed services
//   router()        the API (lib/router.js), for a host to mount behind session.gate
//   start(config)   init, then serve the API at /api and the page at /
var path = require('path');
var fs = require('fs');
var express = require('express');
var { createApp } = require('@xeplr/base-apis');
var store = require('./lib/store');
var session = require('./lib/session');
var services = require('./lib/services');
var systemd = require('./lib/systemd');
var { createRouter } = require('./lib/router');

// What a host must set. Spread into its env.required.js so a missing one
// fails at startup, naming it, rather than booting a monitor nobody can use.
var requiredEnv = ['MONITOR_DATA_DIR', 'MONITOR_SECRET', 'MONITOR_ALLOW'];

/**
 * @param config { dataDir, secret, allow, sudo? }
 *   dataDir  absolute folder for users.json, services.json, audit.ndjson, logs/ (MONITOR_DATA_DIR)
 *   secret   at least 32 characters; signs the sign-in cookie (MONITOR_SECRET)
 *   allow    the services it may control: ["xeplr-*"] or "xeplr-*,postgresql" (MONITOR_ALLOW)
 *   sudo     'actions' (default) | 'all' | 'none' (MONITOR_SUDO)
 */
function init(config) {
  config = config || {};
  store.open(config.dataDir);
  session.setSecret(config.secret);
  services.setAllowed(config.allow);
  systemd.configure({ sudo: config.sudo || 'actions' });
}

function router() { return createRouter(); }

function headers(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
  next();
}

/** The page (built into public/), with every other path answered by index.html. */
function pageRouter(dir) {
  var r = express.Router();
  if (!fs.existsSync(path.join(dir, 'index.html'))) return r;
  r.use(express.static(dir, { index: false, maxAge: '1h' }));
  r.get(/^(?!\/api\/).*/, function(req, res) { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dir, 'index.html')); });
  return r;
}

/**
 * Serve it: the API at /api, the page everywhere else. → the http server,
 * once listening. Listens on 127.0.0.1 unless told otherwise: nginx is its
 * front door.
 */
function start(config) {
  config = config || {};
  init(config);
  // 0 is a port too (any free one); only a missing value takes the default.
  var port = config.port === undefined || config.port === null || config.port === '' ? 19400 : Number(config.port);
  var built = createApp(port, 'xeplr-monitor', {
    host: config.host || '127.0.0.1',
    // Its own sign-in: it must work when @xeplr/auth is down. The headers go in
    // front of it, so a refused request carries them too (createApp's
    // `middleware` runs only after the gate).
    auth: { middleware: function(req, res, next) { headers(req, res, function() { session.gate(req, res, next); }); } },
    corsOptions: { origin: false },              // same-site page only
    log: config.log === false ? false : { logDir: path.join(config.dataDir, 'logs') },
    routes: { '/api': router(), '/': pageRouter(config.publicDir || path.join(__dirname, 'public')) }
  });
  // Behind nginx on the same machine: req.secure and req.ip come from it.
  built.app.set('trust proxy', 'loopback');
  built.app.disable('x-powered-by');
  return new Promise(function(resolve, reject) {
    if (built.server.listening) return resolve(built.server);
    built.server.once('listening', function() { resolve(built.server); });
    built.server.once('error', reject);
  });
}

module.exports = { init: init, router: router, start: start, requiredEnv: requiredEnv, gate: session.gate };
