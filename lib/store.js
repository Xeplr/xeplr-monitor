// THE MONITOR'S OWN FILES — no database. The monitor is what you open when
// something is down, Postgres included, so it keeps everything it needs in
// plain files under MONITOR_DATA_DIR:
//
//   users.json      who can sign in (lib/users.js)
//   services.json   the services it watches, each one added by hand
//   audit.ndjson    every sign-in and every action, one line each, appended
//
// The folder is required and must be absolute: a relative one resolves
// against wherever the process was started, so the same install would read a
// different user list depending on the working directory.
var fs = require('fs');
var path = require('path');

var dir = null;

/** Set the folder, refusing a missing or relative one. Made if it is not there. */
function open(dataDir) {
  if (!dataDir) throw new Error('MONITOR_DATA_DIR is not set: the folder that holds the monitor\'s users, services and audit log');
  if (!path.isAbsolute(dataDir)) throw new Error('MONITOR_DATA_DIR must be an absolute path (it is "' + dataDir + '")');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  dir = dataDir;
  return dir;
}

function where(name) {
  if (!dir) throw new Error('The monitor\'s store is not open: call store.open(MONITOR_DATA_DIR) first');
  return path.join(dir, name);
}

/** A JSON file's content, or `fallback` when it does not exist yet. */
function read(name, fallback) {
  var file = where(name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Write a JSON file whole: to a temporary file, then renamed, so a crash never leaves half of one. */
function write(name, value) {
  var file = where(name);
  var tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** One line added to the audit log. Never throws: an action that worked is not undone by a full disk. */
function audit(entry) {
  try {
    fs.appendFileSync(where('audit.ndjson'), JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n', { mode: 0o600 });
  } catch (e) {
    console.error('[xeplr-monitor] could not write the audit log:', e.message);
  }
}

/** The newest `limit` audit lines, newest first. Reads the end of the file only. */
function recentAudit(limit) {
  var file = where('audit.ndjson');
  if (!fs.existsSync(file)) return [];
  var size = fs.statSync(file).size;
  var want = Math.min(size, 1024 * 1024);
  var fd = fs.openSync(file, 'r');
  var buf = Buffer.alloc(want);
  try { fs.readSync(fd, buf, 0, want, size - want); } finally { fs.closeSync(fd); }
  var lines = buf.toString('utf8').split('\n').filter(Boolean);
  if (want < size) lines.shift(); // the first line was cut in half
  var out = [];
  for (var i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch (e) { /* a line being written */ }
  }
  return out;
}

module.exports = { open: open, read: read, write: write, audit: audit, recentAudit: recentAudit };
