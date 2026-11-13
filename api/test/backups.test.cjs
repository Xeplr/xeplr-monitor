// Backups: a connection as typed, checked (a server login, or a bucket the key
// may only write to), shown without its secret; where a backup goes; and a
// job's connection ids made into logins only of the right kind.
var test = require('node:test');
var assert = require('node:assert');
var connections = require('../lib/connections');
var backups = require('../lib/backups');

test('a database connection is a server login: host, port (default by kind), user and password — no database', function() {
  var c = connections.checked({ name: ' Prod PG ', kind: 'postgres', details: { host: 'db.local', user: 'backup', database: 'ignored' }, secret: { password: 'pw' } });
  assert.deepStrictEqual(c, { name: 'Prod PG', kind: 'postgres', details: { host: 'db.local', port: 5432, user: 'backup' }, secret: { password: 'pw' } });
  assert.equal(connections.checked({ name: 'm', kind: 'mysql', details: { host: 'h', user: 'u' }, secret: { password: 'p' } }).details.port, 3306);
  assert.throws(function() { connections.checked({ name: 'x', kind: 'postgres', details: { host: 'h', user: 'u' } }); }, /Type the password/);
  assert.throws(function() { connections.checked({ name: 'x', kind: 'postgres', details: { host: 'h', user: 'u', port: 70000 }, secret: { password: 'p' } }); }, /1 to 65535/);
  assert.throws(function() { connections.checked({ name: 'x', kind: 'mssql', details: {} }); }, /Kind must be one of/);
  var edit = connections.checked({ name: 'x', kind: 'postgres', details: { host: 'h', user: 'u' }, secret: { password: '' } }, { kind: 'postgres', details: {} });
  assert.equal(edit.secret, null, 'an edit with no password keeps the stored one');
  assert.throws(function() { connections.checked({ name: 'x', kind: 'mysql', details: { host: 'h', user: 'u' } }, { kind: 'postgres' }); }, /keeps its kind/);
});

test('an S3 connection: bucket, region, a folder inside backups/, both keys — only a hint of the key shown', function() {
  var c = connections.checked({ name: 'Backups', kind: 's3', details: { bucket: 'xeplr-db-backups-xksjdjauiqe', region: 'ap-south-1' }, secret: { accessKeyId: 'AKIAABCDEFGHWXYZ', secretAccessKey: 's3cr3t' } });
  assert.deepStrictEqual(c.details, { bucket: 'xeplr-db-backups-xksjdjauiqe', region: 'ap-south-1', prefix: 'backups', accessKeyHint: 'AKIA…WXYZ' });
  assert.deepStrictEqual(c.secret, { accessKeyId: 'AKIAABCDEFGHWXYZ', secretAccessKey: 's3cr3t' });
  assert.equal(connections.checked({ name: 'b', kind: 's3', details: { bucket: 'abc', region: 'ap-south-1', prefix: 'backups/prod/' }, secret: { accessKeyId: 'AKIA1234567890', secretAccessKey: 'x' } }).details.prefix, 'backups/prod');
  assert.throws(function() { connections.checked({ name: 'b', kind: 's3', details: { bucket: 'abc', region: 'ap-south-1', prefix: 'other' }, secret: { accessKeyId: 'a', secretAccessKey: 'b' } }); }, /inside it: the key may only write there/);
  assert.throws(function() { connections.checked({ name: 'b', kind: 's3', details: { bucket: 'Bad_Bucket', region: 'ap-south-1' }, secret: { accessKeyId: 'a', secretAccessKey: 'b' } }); }, /bucket name/);
  assert.throws(function() { connections.checked({ name: 'b', kind: 's3', details: { bucket: 'abc', region: 'mumbai' }, secret: { accessKeyId: 'a', secretAccessKey: 'b' } }); }, /region/);
  assert.throws(function() { connections.checked({ name: 'b', kind: 's3', details: { bucket: 'abc', region: 'ap-south-1' }, secret: { accessKeyId: 'a' } }); }, /both/);
  var kept = connections.checked({ name: 'b', kind: 's3', details: { bucket: 'abc', region: 'ap-south-1' } }, { kind: 's3', details: { accessKeyHint: 'AKIA…WXYZ' } });
  assert.deepStrictEqual([kept.secret, kept.details.accessKeyHint], [null, 'AKIA…WXYZ'], 'an edit with no keys keeps the stored ones');
});

test('what the page gets has no secret', function() {
  var row = { id: '1', name: 'n', kind: 'postgres', details: { host: 'h', port: 5432, user: 'u' }, secret: 'ENCRYPTED', addedBy: 'a@b.c', recordModifiedDate: 'd' };
  var out = connections.shown(row);
  assert.equal(out.secret, undefined);
  assert.equal(out.hasSecret, true);
  assert.ok(JSON.stringify(out).indexOf('ENCRYPTED') < 0);
});

test('where a backup goes: <folder>/<server>/<engine>/<database>/<file>', function() {
  assert.equal(backups.keyFor('backups', 'ip-172-31-24-174', 'postgres', 'taskie', 'taskie-2026-11-14T02-00-00.dump'),
    'backups/ip-172-31-24-174/postgres/taskie/taskie-2026-11-14T02-00-00.dump');
  assert.equal(backups.keyFor('backups/prod/', 'my host', 'mysql', 'a/b', 'f.sql.gz'), 'backups/prod/my-host/mysql/a-b/f.sql.gz', 'nothing from a name can add a folder');
});

test('the backup action\'s form: a server, databases on it (ticks), a bucket — no logins', function() {
  var fields = backups.backupDatabase.inputSchema.filter(function(f) { return !f.hidden; });
  assert.deepStrictEqual(backups.backupDatabase.inputSchema.filter(function(f) { return f.system; }).map(function(f) { return f.name; }), ['dbType', 'connection', 'targetConnection'], 'the logins jobs fills in: declared, hidden, never on the form');
  assert.deepStrictEqual(fields.map(function(f) { return [f.name, f.type, f.optionsFrom, f.dependsOn || null]; }),
    [['connectionInfoId', 'string', 'backupServers', null], ['databases', 'array', 'backupDatabases', 'connectionInfoId'], ['targetConnectionInfoId', 'string', 'backupBuckets', null]]);
  assert.ok(fields.every(function(f) { return !/password|secret/i.test(f.name); }));
});

test('the databases a job names: its list, each once — or the one a job saved before lists', function() {
  assert.deepStrictEqual(backups.databasesOf({ databases: ['xeplr_bi', ' xeplr_bi_jobs ', 'xeplr_bi'] }), ['xeplr_bi', 'xeplr_bi_jobs']);
  assert.deepStrictEqual(backups.databasesOf({ database: 'taskie' }), ['taskie']);
  assert.deepStrictEqual(backups.databasesOf({ databases: [], database: '' }), []);
});

test('several databases: each dumped and uploaded in turn; one failing does not stop the others, and the run fails naming it', async function() {
  var actions = require('@xeplr/actions');
  var real = actions.runAction;
  var calls = [];
  actions.runAction = async function(def, input) {
    calls.push(def.name + ':' + (input.database || input.key));
    if (def.name === 'db-dump') return input.database === 'broken' ? { status: 'failed', error: { message: 'pg_dump: database "broken" does not exist' } }
      : { status: 'success', output: { filePath: '/nowhere/' + input.database + '.dump', fileName: input.database + '.dump', bytes: 10, sha256: 'x' } };
    return { status: 'success', output: { bucket: 'b', key: input.key, versionId: 'v1' } };
  };
  try {
    var input = { dbType: 'postgres', connection: {}, databases: ['xeplr_bi', 'broken', 'xeplr_bi_jobs'], targetConnection: { bucket: 'b', prefix: 'backups' } };
    await assert.rejects(backups.backupDatabase.execute({ input: input, system: {} }), function(err) {
      assert.match(err.message, /^1 of 3 not backed up — broken: The dump: pg_dump: database "broken" does not exist$/);
      assert.deepStrictEqual(err.details.backedUp.map(function(b) { return b.database; }), ['xeplr_bi', 'xeplr_bi_jobs']);
      return true;
    });
    assert.deepStrictEqual(calls.map(function(c) { return c.split(':')[0]; }), ['db-dump', 's3-upload', 'db-dump', 'db-dump', 's3-upload'], 'in turn, the broken one skipped to the next');
    var ok = await backups.backupDatabase.execute({ input: Object.assign({}, input, { databases: ['xeplr_bi'] }), system: {} });
    assert.deepStrictEqual([ok.backedUp.length, ok.failed.length, ok.bucket], [1, 0, 'b']);
  } finally {
    actions.runAction = real;
  }
});

test('the installed @xeplr/actions has db-dump and s3-upload (2.2.2 did not: every backup failed)', function() {
  var b = require('@xeplr/actions').builtins;
  assert.equal(b.dbDump && b.dbDump.name, 'db-dump');
  assert.equal(b.s3Upload && b.s3Upload.name, 's3-upload');
});

test('the run as jobs makes it: the ids swapped for logins and removed — and still valid', async function() {
  var actions = require('@xeplr/actions');
  var made = await actions.resolveConnections({ connectionInfoId: 'pg', targetConnectionInfoId: 's3', databases: ['taskie'] }, async function(id) {
    return id === 'pg' ? { dbType: 'postgres', connection: { host: 'h', user: 'u', password: 'p' } } : { bucket: 'b', region: 'ap-south-1', prefix: 'backups' };
  });
  assert.equal(made.connectionInfoId, undefined, 'jobs removes the id');
  var real = actions.runAction;
  var seen = null;
  actions.runAction = async function(def, input) {
    if (def.name === 'db-dump') return { status: 'success', output: { filePath: '/nowhere/x', fileName: 'x.dump', bytes: 1, sha256: 's' } };
    seen = input;
    return { status: 'success', output: { bucket: 'b', key: input.key } };
  };
  try {
    var result = await real(backups.backupDatabase, made);
    assert.equal(result.status, 'success', JSON.stringify(result.error));
    assert.equal(seen.connection.bucket, 'b');
  } finally {
    actions.runAction = real;
  }
  var none = await real(backups.backupDatabase, { databases: ['taskie'] });
  assert.match(none.error.message, /Choose the database server/);
});
