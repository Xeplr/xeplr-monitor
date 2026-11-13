// FOLDER BACKUPS — `backup-folder`, a job action next to `backup-database`
// (lib/backups.js): folders on this server (uploaded files, an app's data,
// DuckDB files) archived and sent to the same S3 bucket.
//
//   each folder   tar -czf (never through a shell) into this app's data
//                 folder, then s3-upload to
//                 <folder>/<server>/folders/<the path>/<name>-<time>.tar.gz,
//                 then the local archive deleted — whether the upload worked
//                 or not. One failing does not stop the others; the run fails
//                 naming each that did
//   what it reads only what this app's user may read: give it a folder by
//                 adding it to that folder's group (README, "Database backups")
//   never         the whole disk or the kernel's own folders, nor this app's
//                 data folder (it would archive its own archives)
//
// `tar` exits 1 when a file changed while it was read (a log being written):
// the archive is still whole, so that is a success with a warning, not a failure.
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var { spawn } = require('child_process');
var actions = require('@xeplr/actions');
var { dataDir } = require('@xeplr/db');

var NEVER = ['/', '/proc', '/sys', '/dev', '/run', '/boot', '/tmp'];
var MAX_FOLDERS = 20;

function refuse(message) { return new Error(message); }

/** The folders a job names: one per line or comma separated, each once. */
function foldersOf(text) {
  var list = Array.isArray(text) ? text : String(text || '').split(/[\n,]/);
  return list.map(function(f) { return String(f).trim().replace(/\/+$/, '') || (String(f).trim() ? '/' : ''); })
    .filter(function(f, i, all) { return f && all.indexOf(f) === i; });
}

/** Patterns to leave out ("node_modules, *.log"): tar --exclude, never an option of its own. */
function excludesOf(text) {
  return String(text || '').split(/[\n,]/).map(function(p) { return p.trim(); })
    .filter(function(p) { return p && p[0] !== '-'; });
}

/** A folder we may archive: absolute, a real folder, readable, and not one we never touch. → its real path. */
function checkedFolder(folder, ownData) {
  if (!path.isAbsolute(folder)) throw refuse(folder + ': give the full path, starting with /');
  var real;
  try { real = fs.realpathSync(folder); } catch (e) { throw refuse(folder + ': there is no such folder on this server'); }
  if (!fs.statSync(real).isDirectory()) throw refuse(folder + ': that is a file, not a folder');
  if (NEVER.indexOf(real) >= 0) throw refuse(folder + ': not a folder to back up whole — name the folders inside it');
  if (ownData && (real === ownData || real.indexOf(ownData + path.sep) === 0 || ownData.indexOf(real + path.sep) === 0)) {
    throw refuse(folder + ': holds the backups\' own working folder — name a folder beside it');
  }
  try { fs.accessSync(real, fs.constants.R_OK | fs.constants.X_OK); } catch (e) {
    throw refuse(folder + ': this app (user ' + os.userInfo().username + ') may not read it — add that user to the folder\'s group');
  }
  return real;
}

/** "/var/lib/xeplr-bi/data" → "var-lib-xeplr-bi-data": the folder as one name, for the key and the file. */
function slugOf(folder) {
  return folder.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '-') || 'root';
}

function stamp(now) { return now.toISOString().slice(0, 19).replace(/:/g, '-'); }

/** tar -czf <out> -C <parent> [--exclude=…] <name>. Resolves to { warning } — tar's "file changed" is not a failure. */
function archive(real, out, excludes, signal) {
  return new Promise(function(resolve, reject) {
    var args = ['-czf', out].concat(excludes.map(function(p) { return '--exclude=' + p; }), ['-C', path.dirname(real), '--', path.basename(real)]);
    var child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    var err = '';
    child.stderr.on('data', function(d) { err = (err + d).slice(-2000); });
    var stop = function() { child.kill('SIGTERM'); };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('error', function(e) { reject(e.code === 'ENOENT' ? refuse('tar is not installed on this server') : e); });
    child.on('close', function(code) {
      if (signal) signal.removeEventListener('abort', stop);
      if (signal && signal.aborted) return reject(refuse('Stopped'));
      if (code === 0) return resolve({ warning: null });
      if (code === 1) return resolve({ warning: err.trim().split('\n').slice(-3).join(' ') || 'some files changed while they were read' });
      reject(refuse('tar failed: ' + (err.trim().split('\n').slice(-3).join(' ') || 'exit ' + code)));
    });
  });
}

function sha256Of(file) {
  return new Promise(function(resolve, reject) {
    var h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', function(d) { h.update(d); }).on('end', function() { resolve(h.digest('hex')); }).on('error', reject);
  });
}

/** One folder: archived, uploaded, the local archive deleted. */
async function backupOne(folder, input, system, deps) {
  var started = Date.now();
  var ownData = deps.ownData();
  var real = checkedFolder(folder, ownData);
  var dir = dataDir.resolve('backups', 'The backup folder');
  fs.mkdirSync(dir, { recursive: true });
  var name = slugOf(real) + '-' + stamp(new Date()) + '.tar.gz';
  var file = path.join(dir, name);
  var partial = file + '.partial';
  try {
    var made = await deps.archive(real, partial, excludesOf(input.exclude), system.signal);
    fs.renameSync(partial, file);
    var bytes = fs.statSync(file).size;
    var sha256 = await sha256Of(file);
    var bucket = input.targetConnection;
    var key = [String(bucket.prefix || 'backups').replace(/\/+$/, ''), os.hostname().replace(/[^A-Za-z0-9._-]+/g, '-'), 'folders', slugOf(real), name].join('/');
    var upload = await actions.runAction(actions.builtins.s3Upload, { connection: bucket, filePath: file, key: key }, { system: system });
    if (upload.status !== 'success') throw refuse('The upload: ' + ((upload.error && upload.error.message) || 'failed'));
    return { folder: real, fileName: name, bytes: bytes, sha256: sha256, key: upload.output.key, versionId: upload.output.versionId || null, warning: made.warning, durationMs: Date.now() - started };
  } finally {
    fs.rm(partial, { force: true }, function() {});
    fs.rm(file, { force: true }, function() {});
  }
}

function createFolderBackup(deps) {
  deps = Object.assign({ archive: archive, ownData: function() { try { return fs.realpathSync(dataDir.root()); } catch (e) { return null; } } }, deps || {});
  return {
    name: 'backup-folder',
    description: 'Back up folders on this server to S3: each archived (.tar.gz), uploaded, and the local archive deleted.',
    inputSchema: [
      { name: 'folders', label: 'Folders', type: 'string', required: true, order: 1,
        description: 'Full paths on this server, comma separated — e.g. /var/lib/xeplr-bi/data, /opt/app/uploads.' },
      { name: 'exclude', label: 'Leave out', type: 'string', order: 2,
        description: 'Names or patterns to skip, comma separated — e.g. node_modules, *.log, tmp.' },
      // NOT `required`: jobs removes the id once it has filled in the login (see lib/backups.js).
      { name: 'targetConnectionInfoId', label: 'Upload to', type: 'string', order: 3, optionsFrom: 'backupBuckets',
        description: 'A saved S3 bucket (Backup connections).' },
      { name: 'targetConnection', type: 'object', hidden: true, system: true }
    ],
    example: { bucket: 'xeplr-db-backups', backedUp: [{ folder: '/var/lib/xeplr-bi/data', fileName: 'var-lib-xeplr-bi-data-2026-11-14T02-00-00.tar.gz', bytes: 104857600, key: 'backups/ip-172-31-24-174/folders/var-lib-xeplr-bi-data/var-lib-xeplr-bi-data-2026-11-14T02-00-00.tar.gz' }], failed: [] },
    execute: async function(ctx) {
      var input = ctx.input;
      var system = ctx.system || {};
      if (!input.targetConnection) throw refuse('Choose where to upload to');
      var folders = foldersOf(input.folders);
      if (!folders.length) throw refuse('Name at least one folder');
      if (folders.length > MAX_FOLDERS) throw refuse('At most ' + MAX_FOLDERS + ' folders in one job');
      var done = [];
      var bad = [];
      for (var i = 0; i < folders.length; i++) {
        try { done.push(await backupOne(folders[i], input, system, deps)); } catch (err) { bad.push({ folder: folders[i], error: err.message }); }
      }
      var out = { bucket: input.targetConnection.bucket, backedUp: done, failed: bad };
      if (bad.length) {
        var e = new Error(bad.length + ' of ' + folders.length + ' not backed up — ' + bad.map(function(b) { return b.error; }).join('; '));
        e.details = out;
        throw e;
      }
      return out;
    }
  };
}

module.exports = { createFolderBackup: createFolderBackup, foldersOf: foldersOf, excludesOf: excludesOf, checkedFolder: checkedFolder, slugOf: slugOf, archive: archive };
