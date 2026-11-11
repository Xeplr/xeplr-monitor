// @xeplr/monitor — see and control a server's services: status, start, stop,
// restart, kill, and their logs, live. Its own sign-in, its own files, no
// database: it is what you open when something else is down.
//
//   init(config)    open the store, the secret, the allowed services
//   router()        the API (lib/router.js), for a host to mount
//   start(config)   init, then serve the API at /api and the page at /
var path = require('path');
var fs = require('fs');
var express = require('express');
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
 *   dataDir  absolute folder for users.json, services.json, audit.ndjson (MONITOR_DATA_DIR)
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

/** The whole monitor on one port: the API at /api, the page everywhere else. */
function createApp(config) {
  init(config);
  var app = express();
  // Behind nginx on the same machine: req.secure and req.ip come from it.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(function(req, res, next) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    next();
  });
  app.use('/api', router());
  app.use('/api', function(req, res) { res.status(404).json({ error: 'No such route' }); });
  var page = config.publicDir || path.join(__dirname, 'public');
  if (fs.existsSync(path.join(page, 'index.html'))) {
    app.use(express.static(page, { index: false, maxAge: '1h' }));
    app.get(/.*/, function(req, res) { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(page, 'index.html')); });
  }
  return app;
}

/** Serve it. → the http server. Listens on 127.0.0.1 unless told otherwise: nginx is its front door. */
function start(config) {
  config = config || {};
  var app = createApp(config);
  // 0 is a port too (any free one); only a missing value takes the default.
  var port = config.port === undefined || config.port === null || config.port === '' ? 19400 : Number(config.port);
  var host = config.host || '127.0.0.1';
  return new Promise(function(resolve, reject) {
    // Express 5 hands a listen error to this callback as well.
    var server = app.listen(port, host, function(err) {
      if (err) return reject(err);
      console.log('[xeplr-monitor] listening on http://' + host + ':' + server.address().port);
      resolve(server);
    });
  });
}

module.exports = { init: init, router: router, createApp: createApp, start: start, requiredEnv: requiredEnv };
