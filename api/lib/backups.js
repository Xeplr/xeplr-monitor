// THE BACKUP JOBS — @xeplr/jobs, in their own database (DB_JOBS), run by this
// API. Each job backs up one database on a saved server (lib/connections.js)
// to a saved S3 bucket, on the schedule set on the Jobs page:
//
//   backup-database   for each database chosen (one app's together, in one
//                     job), one after another: db-dump (pg_dump / mysqldump,
//                     @xeplr/actions) into this app's data folder, s3-upload to
//                     <folder>/<server>/<engine>/<database>/<file>, and the
//                     local file deleted — whether the upload worked or not, so
//                     a failing bucket never fills the disk. One failing does
//                     not stop the others; the run fails, naming each that did
//
// A job holds the connections' ids; the logins are filled in just for the run
// (resolveConnection below), so no password is in a job or its run history.
var fs = require('fs');
var os = require('os');
var path = require('path');
var jobs = require('@xeplr/jobs');
var actions = require('@xeplr/actions');
var connections = require('./connections');

// Kinds of things a job's dropdowns list (ui-jobs optionSources, ui/src/App.jsx).
var OPTIONS = { servers: 'backupServers', databases: 'backupDatabases', buckets: 'backupBuckets' };

function failed(step, result) {
  var e = new Error(step + ': ' + ((result.error && result.error.message) || 'failed'));
  e.details = result.error || null;
  return e;
}

/** Where a backup goes: <folder>/<server>/<engine>/<database>/<file>. */
function keyFor(prefix, host, dbType, database, fileName) {
  var safe = function(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '-'); };
  return [String(prefix || connections.PREFIX_ROOT).replace(/\/+$/, ''), safe(host), dbType, safe(database), fileName].join('/');
}

/** One database: dumped, uploaded, the local file deleted. */
async function backupOne(input, database, system) {
  var started = Date.now();
  var dump = await actions.runAction(actions.builtins.dbDump, { dbType: input.dbType, connection: input.connection, database: database }, { system: system });
  if (dump.status !== 'success') throw failed('The dump', dump);
  var file = dump.output;
  try {
    var bucket = input.targetConnection;
    var key = keyFor(bucket.prefix, os.hostname(), input.dbType, database, file.fileName);
    var upload = await actions.runAction(actions.builtins.s3Upload, { connection: bucket, filePath: file.filePath, key: key }, { system: system });
    if (upload.status !== 'success') throw failed('The upload', upload);
    return { database: database, fileName: file.fileName, bytes: file.bytes, sha256: file.sha256, key: upload.output.key, versionId: upload.output.versionId || null, durationMs: Date.now() - started };
  } finally {
    fs.rm(file.filePath, { force: true }, function() {});
  }
}

/** The databases a job names: its list, or the one a job saved before lists had. Each once. */
function databasesOf(input) {
  var list = Array.isArray(input.databases) ? input.databases : [];
  if (!list.length && input.database) list = [input.database];
  return list.map(function(d) { return String(d).trim(); }).filter(function(d, i, all) { return d && all.indexOf(d) === i; });
}

var backupDatabase = {
  name: 'backup-database',
  description: 'Back up databases to S3 — one app\'s together: dump each (pg_dump / mysqldump), upload it, delete the local copy.',
  inputSchema: [
    // NOT `required`: jobs swaps each *ConnectionInfoId for its login and
    // removes the id before the action's inputs are checked, so a required id
    // fails every run ("Missing required input field"). execute checks the
    // logins arrived instead.
    { name: 'connectionInfoId', label: 'Database server', type: 'string', order: 1, optionsFrom: OPTIONS.servers,
      description: 'A saved database server (Backup connections).' },
    { name: 'databases', label: 'Databases', type: 'array', order: 2, optionsFrom: OPTIONS.databases, dependsOn: 'connectionInfoId',
      description: 'Which databases on that server — one app\'s together. Backed up one after another.' },
    { name: 'database', type: 'string', hidden: true, order: 3,
      description: 'One database: a job saved before Databases was a list.' },
    { name: 'targetConnectionInfoId', label: 'Upload to', type: 'string', order: 4, optionsFrom: OPTIONS.buckets,
      description: 'A saved S3 bucket (Backup connections).' },
    // What jobs fills in for the run from the two ids above — declared, or the
    // input check strips them before execute sees them. Never saved in a job.
    { name: 'dbType', type: 'string', hidden: true, system: true },
    { name: 'connection', type: 'object', hidden: true, system: true },
    { name: 'targetConnection', type: 'object', hidden: true, system: true }
  ],
  example: { bucket: 'xeplr-db-backups', backedUp: [{ database: 'taskie', fileName: 'taskie-2026-11-14T02-00-00.dump', bytes: 52428800, key: 'backups/ip-172-31-24-174/postgres/taskie/taskie-2026-11-14T02-00-00.dump' }], failed: [] },
  execute: async function(ctx) {
    var input = ctx.input;
    var system = ctx.system || {};
    if (!input.connection) throw new Error('Choose the database server');
    if (!input.targetConnection) throw new Error('Choose where to upload to');
    var names = databasesOf(input);
    if (!names.length) throw new Error('Choose at least one database');
    var done = [];
    var bad = [];
    for (var i = 0; i < names.length; i++) {
      try { done.push(await backupOne(input, names[i], system)); } catch (err) { bad.push({ database: names[i], error: err.message }); }
    }
    var out = { bucket: input.targetConnection.bucket, dbType: input.dbType, backedUp: done, failed: bad };
    if (bad.length) {
      var e = new Error(bad.length + ' of ' + names.length + ' not backed up — ' + bad.map(function(b) { return b.database + ': ' + b.error; }).join('; '));
      e.details = out;
      throw e;
    }
    return out;
  }
};

/** A job's connection id → the login, for that run only. The database server's login carries the job's database. */
async function resolveConnection(id, at) {
  if (at.field === 'targetConnectionInfoId') {
    var row = await connections.get(id);
    if (row.kind !== 's3') throw new Error('"Upload to" must be an S3 connection; ' + row.name + ' is ' + row.kind);
    return connections.resolve(id);
  }
  var server = await connections.get(id);
  if (connections.DATABASE_KINDS.indexOf(server.kind) < 0) throw new Error('"Database server" must be a Postgres or MySQL connection; ' + server.name + ' is S3');
  // A server login: each database is the action's own input, not the login's.
  return connections.resolve(id);
}

/** The jobs still naming a connection — a connection in use is not removed. */
async function jobsUsing(id) {
  var Job = jobs.boundModels().Job;
  var rows = await Job.query().select('name')
    .whereRaw('("inputs"::jsonb ->> \'connectionInfoId\') = ? OR ("inputs"::jsonb ->> \'targetConnectionInfoId\') = ?', [id, id]);
  return rows.map(function(r) { return r.name; });
}

/** The jobs database: made if missing, then the package's own migrations. */
async function migrate() {
  var db = require('@xeplr/db');
  var resolved = await db.resolveConfig('api');
  await db.ensureDatabaseFor(resolved, process.env.DB_JOBS);
  var result = await db.migrator.up({
    db: process.env.DB_JOBS,
    dir: path.join(path.dirname(require.resolve('@xeplr/jobs')), 'migrations'),
    connectionName: 'api'
  });
  if (result.migrations.length) console.log('[jobs] ran migrations: ' + result.migrations.join(', '));
}

/** Migrate, start @xeplr/jobs with only the backup action, start the scheduler. */
async function start() {
  await migrate();
  await jobs.init({
    database: process.env.DB_JOBS,
    connection: process.env.XEPLR_MONITOR_CONNECTION,
    defaultActions: false,
    resolveConnection: resolveConnection
  });
  jobs.registerAction(backupDatabase);
  jobs.startScheduler({ intervalMs: 10000 });
  console.log('[jobs] scheduler started: backup-database');
}

module.exports = { start: start, backupDatabase: backupDatabase, databasesOf: databasesOf, resolveConnection: resolveConnection, jobsUsing: jobsUsing, keyFor: keyFor, OPTIONS: OPTIONS };
