// Folder backups: which folders and patterns a job names, the folders never
// archived, and a real tar of a real folder — uploaded, then gone from disk.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFileSync } = require('child_process');

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'xm-folders-'));
process.env.XEPLR_DATA_DIR = path.join(root, 'data');
fs.mkdirSync(process.env.XEPLR_DATA_DIR);
require('@xeplr/db').registerApplication('xeplr-monitor-test');
var fb = require('../lib/folderBackup');
var actions = require('@xeplr/actions');

test('the folders a job names: comma or one per line, each once; patterns never an option', function() {
  assert.deepStrictEqual(fb.foldersOf('/var/lib/a/, /opt/b\n/var/lib/a'), ['/var/lib/a', '/opt/b']);
  assert.deepStrictEqual(fb.excludesOf('node_modules, *.log, --to-command=sh'), ['node_modules', '*.log']);
  assert.equal(fb.slugOf('/var/lib/xeplr-bi/data'), 'var-lib-xeplr-bi-data');
});

test('never the whole disk, the kernel\'s folders, a relative path, a file, or the backups\' own folder', function() {
  assert.throws(function() { fb.checkedFolder('/'); }, /not a folder to back up whole/);
  assert.throws(function() { fb.checkedFolder('/proc'); }, /not a folder to back up whole|no such folder/);
  assert.throws(function() { fb.checkedFolder('data'); }, /full path/);
  assert.throws(function() { fb.checkedFolder(path.join(root, 'missing')); }, /no such folder/);
  fs.writeFileSync(path.join(root, 'a-file'), 'x');
  assert.throws(function() { fb.checkedFolder(path.join(root, 'a-file')); }, /a file, not a folder/);
  var own = fs.realpathSync(process.env.XEPLR_DATA_DIR);
  assert.throws(function() { fb.checkedFolder(process.env.XEPLR_DATA_DIR, own); }, /backups' own working folder/);
  assert.throws(function() { fb.checkedFolder(root, own); }, /backups' own working folder/, 'nor a folder holding it');
});

test('a real folder: archived with tar (patterns left out), uploaded, the local archive deleted; a missing one fails the run, naming it', async function() {
  var src = path.join(root, 'site', 'uploads');
  fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(src, 'invoice.pdf'), 'pdf');
  fs.writeFileSync(path.join(src, 'app.log'), 'log');
  fs.writeFileSync(path.join(src, 'node_modules', 'x.js'), 'js');
  var real = actions.runAction;
  var uploaded = [];
  actions.runAction = async function(def, input) {
    uploaded.push({ key: input.key, entries: execFileSync('tar', ['-tzf', input.filePath]).toString().trim().split('\n').sort() });
    return { status: 'success', output: { bucket: 'b', key: input.key, versionId: 'v' } };
  };
  try {
    var action = fb.createFolderBackup({ ownData: function() { return fs.realpathSync(process.env.XEPLR_DATA_DIR); } });
    var out = await action.execute({ input: { folders: src, exclude: 'node_modules, *.log', targetConnection: { bucket: 'b', prefix: 'backups' } }, system: {} });
    assert.equal(out.backedUp.length, 1);
    assert.deepStrictEqual(uploaded[0].entries.filter(function(e) { return !/\/$/.test(e); }), ['uploads/invoice.pdf'], 'node_modules and *.log left out');
    assert.match(uploaded[0].key, new RegExp('^backups/[^/]+/folders/' + fb.slugOf(fs.realpathSync(src)) + '/.+\\.tar\\.gz$'));
    await new Promise(function(r) { setTimeout(r, 50); });
    var left = fs.readdirSync(path.join(fs.realpathSync(process.env.XEPLR_DATA_DIR), 'xeplr-monitor-test', 'backups'));
    assert.deepStrictEqual(left, [], 'nothing left on disk');

    await assert.rejects(action.execute({ input: { folders: src + ', /no/such', targetConnection: { bucket: 'b' } }, system: {} }), function(err) {
      assert.match(err.message, /^1 of 2 not backed up — \/no\/such: there is no such folder on this server$/);
      assert.equal(err.details.backedUp.length, 1);
      return true;
    });
  } finally {
    actions.runAction = real;
  }
});

test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
