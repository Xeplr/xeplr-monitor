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

test('the backup action\'s form: a server, a database on it, a bucket — dropdowns, no logins', function() {
  var fields = backups.backupDatabase.inputSchema;
  assert.deepStrictEqual(fields.map(function(f) { return [f.name, f.optionsFrom, f.dependsOn || null]; }),
    [['connectionInfoId', 'backupServers', null], ['database', 'backupDatabases', 'connectionInfoId'], ['targetConnectionInfoId', 'backupBuckets', null]]);
  assert.ok(fields.every(function(f) { return !/password|secret/i.test(f.name); }));
});
