// THE LOGINS THE BACKUP JOBS USE — rows of backup_connections.
//
//   a database   a SERVER login: Postgres or MySQL, host, port, user and
//                password. Which database on it to back up is the job's
//                choice (databasesOn lists them for its dropdown)
//   an S3 one    a bucket, its region, the folder backups go in, and an
//                access key that can only write there
//
// What is not secret is kept as it is and shown on the page; the password or
// secret key is encrypted with ENCRYPTION_KEY (@xeplr/utils) and only ever
// decrypted by resolve(), moments before a job's run uses it. A job holds the
// row's id, never the login (@xeplr/actions resolveConnections).
var { generateId } = require('@xeplr/utils');
var { encrypt, decrypt } = require('@xeplr/utils/isomorphic/crypto');
var { BackupConnection } = require('../models');

var KINDS = ['postgres', 'mysql', 's3'];
var DATABASE_KINDS = ['postgres', 'mysql'];
var DEFAULT_PORTS = { postgres: 5432, mysql: 3306 };
// The only folder the backup key may write in (its IAM policy: backups/*).
var PREFIX_ROOT = 'backups';
// Databases a server keeps for itself: never offered for a backup.
var SYSTEM_DATABASES = { postgres: ['postgres', 'template0', 'template1'], mysql: ['information_schema', 'performance_schema', 'mysql', 'sys'] };

function refuse(message, status) { var e = new Error(message); e.status = status || 400; return e; }
function text(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 200); }
function key() { return process.env.ENCRYPTION_KEY; }

/** "AKIA…WXYZ": enough to tell keys apart, nothing to sign in with. */
function keyHint(id) {
  var s = text(id, 128);
  return s.length > 8 ? s.slice(0, 4) + '…' + s.slice(-4) : (s ? '…' : '');
}

/**
 * A connection as sent, checked: { name, kind, details, secret } — the secret
 * only when typed (blank on an edit keeps the stored one, `previous`).
 * @returns {{ name: string, kind: string, details: object, secret: object|null }}
 */
function checked(body, previous) {
  body = body || {};
  var name = text(body.name, 80);
  if (!name) throw refuse('Give it a name');
  var kind = text(body.kind, 20).toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw refuse('Kind must be one of: ' + KINDS.join(', '));
  if (previous && previous.kind !== kind) throw refuse('A connection keeps its kind — add a new one instead');
  var d = body.details || {};
  var s = body.secret || {};
  var details;
  var secret = null;
  if (DATABASE_KINDS.indexOf(kind) >= 0) {
    var port = d.port === undefined || d.port === '' ? DEFAULT_PORTS[kind] : Number(d.port);
    details = { host: text(d.host), port: port, user: text(d.user, 120) };
    if (!details.host) throw refuse('Say which host the database server is on');
    if (!(Number.isInteger(port) && port > 0 && port < 65536)) throw refuse('The port is a number from 1 to 65535');
    if (!details.user) throw refuse('Say which user to sign in as');
    if (s.password) secret = { password: String(s.password) };
    else if (!previous) throw refuse('Type the password');
  } else {
    var prefix = text(d.prefix || PREFIX_ROOT, 200).replace(/^\/+|\/+$/g, '');
    details = { bucket: text(d.bucket, 63).toLowerCase(), region: text(d.region, 40), prefix: prefix };
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(details.bucket)) throw refuse('A bucket name is 3 to 63 lowercase letters, numbers, dots and hyphens');
    if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(details.region)) throw refuse('Give the bucket\'s region, e.g. ap-south-1');
    if (prefix !== PREFIX_ROOT && prefix.indexOf(PREFIX_ROOT + '/') !== 0) throw refuse('The folder must be "' + PREFIX_ROOT + '" or inside it: the key may only write there');
    var id = text(s.accessKeyId, 128);
    var secretKey = s.secretAccessKey ? String(s.secretAccessKey) : '';
    if (id || secretKey) {
      if (!id || !secretKey) throw refuse('Type both the access key ID and the secret access key');
      secret = { accessKeyId: id, secretAccessKey: secretKey };
      details.accessKeyHint = keyHint(id);
    } else if (!previous) {
      throw refuse('Type the access key ID and the secret access key');
    } else {
      details.accessKeyHint = previous.details && previous.details.accessKeyHint;
    }
  }
  return { name: name, kind: kind, details: details, secret: secret };
}

/** A row as the page sees it: never the secret. */
function shown(row) {
  return { id: row.id, name: row.name, kind: row.kind, details: row.details, hasSecret: Boolean(row.secret), addedBy: row.addedBy || null, recordModifiedDate: row.recordModifiedDate };
}

function all() { return BackupConnection.query().orderBy('name'); }

async function get(id) {
  var row = await BackupConnection.query().findById(text(id, 25));
  if (!row) throw refuse('No such connection', 404);
  return row;
}

async function nameTaken(name, id) {
  var q = BackupConnection.query().whereRaw('lower("name") = ?', [name.toLowerCase()]);
  if (id) q = q.whereNot('id', id);
  return Boolean(await q.first());
}

async function add(body, by) {
  var c = checked(body);
  if (await nameTaken(c.name)) throw refuse('There is already a connection called ' + c.name, 409);
  var row = await BackupConnection.query().insert({ id: generateId(), name: c.name, kind: c.kind, details: c.details, secret: await encrypt(JSON.stringify(c.secret), key()), addedBy: by });
  return shown(row);
}

async function edit(id, body) {
  var was = await get(id);
  var c = checked(body, was);
  if (await nameTaken(c.name, was.id)) throw refuse('There is already a connection called ' + c.name, 409);
  var patch = { name: c.name, details: c.details, recordModifiedDate: new Date().toISOString() };
  if (c.secret) patch.secret = await encrypt(JSON.stringify(c.secret), key());
  return shown(await BackupConnection.query().patchAndFetchById(was.id, patch));
}

async function remove(id) {
  var row = await get(id);
  await BackupConnection.query().deleteById(row.id);
}

/**
 * A connection's login, for one run: databases → { dbType, connection: { host,
 * port, user, password, database? } }; S3 → { bucket, region, prefix,
 * accessKeyId, secretAccessKey }. Only ever called by the jobs' resolver.
 */
async function resolve(id, database) {
  var row = await get(id);
  var secret = JSON.parse(await decrypt(row.secret, key()));
  if (row.kind === 's3') return Object.assign({}, row.details, { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey });
  var connection = { host: row.details.host, port: row.details.port, user: row.details.user, password: secret.password };
  if (database) connection.database = database;
  return { dbType: row.kind, connection: connection };
}

/** The databases on a database server, for a job's dropdown — the server's own left out. */
async function databasesOn(id) {
  var row = await get(id);
  if (DATABASE_KINDS.indexOf(row.kind) < 0) throw refuse(row.name + ' is not a database server');
  var login = await resolve(row.id, row.kind === 'postgres' ? 'postgres' : undefined);
  var driver = require('@xeplr/actions').drivers.db.getDriver(row.kind);
  var pool = await driver.connect(Object.assign({}, login.connection, { maxConnections: 1, readOnly: true }));
  try {
    var sql = row.kind === 'postgres' ? 'SELECT datname AS name FROM pg_database WHERE datallowconn ORDER BY 1' : 'SHOW DATABASES';
    var res = await driver.query(pool, sql, [], { timeoutMs: 10000 });
    var rows = Array.isArray(res) ? res : (res.rows || []);
    return rows.map(function(r) { return r.name || r.Database; }).filter(function(n) { return n && SYSTEM_DATABASES[row.kind].indexOf(n) < 0; });
  } finally {
    await driver.close(pool);
  }
}

/** Can it sign in? Databases: connects and counts them. S3: the key can only write, so the first backup is the test. */
async function test(id) {
  var row = await get(id);
  if (row.kind === 's3') return { ok: true, message: 'S3 keys can only write — checked by the first backup' };
  try {
    var names = await databasesOn(row.id);
    return { ok: true, message: 'Connected: ' + names.length + (names.length === 1 ? ' database' : ' databases') };
  } catch (err) {
    return { ok: false, message: 'Could not connect: ' + err.message };
  }
}

module.exports = {
  KINDS: KINDS, DATABASE_KINDS: DATABASE_KINDS, PREFIX_ROOT: PREFIX_ROOT,
  checked: checked, shown: shown, keyHint: keyHint,
  all: all, get: get, add: add, edit: edit, remove: remove, resolve: resolve, databasesOn: databasesOn, test: test
};
