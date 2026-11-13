// The backups this app runs are @xeplr/backups': both actions there, the steps
// they run in the installed @xeplr/actions (2.2.2 had none and every backup
// failed), and one copy of each package, so the actions run on this app's
// own database connection and data folder.
var test = require('node:test');
var assert = require('node:assert');
var path = require('path');

test('@xeplr/backups: both actions, and every step they run in the installed @xeplr/actions', function() {
  var backups = require('@xeplr/backups');
  assert.deepStrictEqual(Object.values(backups.actions).map(function(a) { return a.name; }), ['backup-database', 'backup-folder']);
  var b = require('@xeplr/actions').builtins;
  assert.deepStrictEqual([b.dbDump && b.dbDump.name, b.s3Upload && b.s3Upload.name, b.folderArchive && b.folderArchive.name], ['db-dump', 's3-upload', 'folder-archive']);
});

test('one copy of @xeplr/actions and @xeplr/db — the package\'s are this app\'s', function() {
  var from = path.dirname(require.resolve('@xeplr/backups/package.json'));
  ['@xeplr/actions', '@xeplr/db'].forEach(function(name) {
    assert.equal(require.resolve(name, { paths: [from] }), require.resolve(name), name);
  });
});
