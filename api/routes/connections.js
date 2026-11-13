// THE BACKUP CONNECTIONS' ROUTES — at /api/monitor/connections, behind
// createApp's auth gate. The logins the backup jobs use (lib/connections.js);
// a password or secret key goes in and never comes back out.
//
//   GET    /                 every connection (never its secret) — the Connections page
//   POST   /                 { name, kind, details, secret } — add one
//   PATCH  /:id              the same; a blank secret keeps the stored one
//   DELETE /:id              remove it, unless a job still uses it (409, naming the jobs)
//   POST   /:id/test         can it sign in? { ok, message }
//   GET    /servers          the database servers, for a job's "Database server"
//   GET    /databases        ?connectionInfoId= — the databases on it, for a job's "Database"
//   GET    /buckets          the S3 buckets, for a job's "Upload to"
//
// Each change is written to monitor_audit, refused ones too.
var express = require('express');
var { requireApi } = require('@xeplr/base-apis');
var connections = require('../lib/connections');
var services = require('../lib/services');

// The `apis` rows these routes are checked against (migrations-auth/0008_backups.sql).
var API = {
  list: 'List backup connections',
  save: 'Save a backup connection',
  remove: 'Remove a backup connection',
  test: 'Test a backup connection'
};

var router = express.Router();

function who(req) { return (req.user && (req.user.email || req.user.id)) || 'unknown'; }
function ipOf(req) { return req.ip || (req.socket && req.socket.remoteAddress) || null; }

function answer(fn) {
  return function(req, res, next) {
    Promise.resolve().then(function() { return fn(req, res); }).then(function(out) {
      if (!res.headersSent) res.json(out === undefined ? { ok: true } : out);
    }).catch(function(err) { if (!res.headersSent) next(err); });
  };
}

// A change, in the audit log whether it worked or not — by the connection's name, never its secret.
function change(action, fn) {
  return answer(async function(req) {
    var name = (req.body && req.body.name) || req.params.id || null;
    try {
      var out = await fn(req);
      await services.audit({ email: who(req), ip: ipOf(req), action: action, unit: 'connection: ' + ((out && out.connection && out.connection.name) || name), ok: true });
      return out;
    } catch (err) {
      await services.audit({ email: who(req), ip: ipOf(req), action: action, unit: 'connection: ' + name, ok: false, error: err.message });
      throw err;
    }
  });
}

function options(kinds) {
  return answer(async function() {
    var rows = (await connections.all()).filter(function(r) { return kinds.indexOf(r.kind) >= 0; });
    return { dataArray: rows.map(function(r) { return { id: r.id, name: r.name, kind: r.kind }; }) };
  });
}

router.get('/', requireApi(API.list), answer(async function() {
  return { dataArray: (await connections.all()).map(connections.shown) };
}));
router.get('/servers', requireApi(API.list), options(connections.DATABASE_KINDS));
router.get('/buckets', requireApi(API.list), options(['s3']));
router.get('/databases', requireApi(API.list), answer(async function(req) {
  var id = req.query.connectionInfoId;
  if (!id) return { dataArray: [] };
  return { dataArray: (await connections.databasesOn(id)).map(function(n) { return { id: n, name: n }; }) };
}));

router.post('/', requireApi(API.save), change('connection-add', async function(req) { return { connection: await connections.add(req.body, who(req)) }; }));
router.patch('/:id', requireApi(API.save), change('connection-edit', async function(req) { return { connection: await connections.edit(req.params.id, req.body) }; }));
router.delete('/:id', requireApi(API.remove), change('connection-remove', async function(req) {
  var row = await connections.get(req.params.id);
  var using = await require('../lib/backups').jobsUsing(row.id);
  if (using.length) { var e = new Error(row.name + ' is used by ' + using.join(', ') + ' — change or delete ' + (using.length === 1 ? 'that job' : 'those jobs') + ' first'); e.status = 409; throw e; }
  await connections.remove(row.id);
  return { ok: true, connection: { name: row.name } };
}));
router.post('/:id/test', requireApi(API.test), answer(function(req) { return connections.test(req.params.id); }));

router.API = API;
module.exports = router;
