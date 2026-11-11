// SYSTEMD — how the monitor sees and controls a service. The apps already run
// as systemd services on the servers (xeplr-bi-api, -auth, -jobs; testbi's
// xeplr-bi-dev-*), so the monitor starts nothing itself: it asks systemctl,
// the same way the deploy does, and reads the journal, where their output goes.
//
// No shell is ever involved: every call is execFile/spawn with an argument
// list, and a unit name is checked against UNIT before it reaches one. Only
// start, stop, restart and kill change anything.
//
// sudo: 'actions' (the default) runs those four through `sudo -n`, which the
// sudoers file in deploy/ allows for the allowed services only; 'all' reads
// the journal through sudo too; 'none' runs everything as the monitor's own
// user (root, or a user in the systemd-journal group that has polkit rights).
var { execFile, spawn } = require('child_process');
var fs = require('fs');

var UNIT = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,200}$/;
var ACTIONS = ['start', 'stop', 'restart', 'kill'];
var ACTION_LIMIT_MS = 2 * 60 * 1000; // a stop waits for the service's own stop timeout (90s by default)
var READ_LIMIT_MS = 30 * 1000;
var MAX_LINES = 5000;
var PROPS = ['Id', 'Description', 'LoadState', 'ActiveState', 'SubState', 'Result', 'MainPID', 'NRestarts',
  'ActiveEnterTimestamp', 'InactiveEnterTimestamp', 'ExecMainStatus', 'MemoryCurrent', 'CPUUsageNSec', 'UnitFileState', 'Restart'];

var cfg = { sudo: 'actions', systemctl: 'systemctl', journalctl: 'journalctl' };

function configure(o) {
  o = o || {};
  if (o.sudo && ['actions', 'all', 'none'].indexOf(o.sudo) < 0) throw new Error('MONITOR_SUDO must be actions, all or none (it is "' + o.sudo + '")');
  cfg = Object.assign({}, cfg, o);
  // Running as root, sudo adds nothing.
  if (process.getuid && process.getuid() === 0) cfg.sudo = 'none';
  return cfg;
}

function refuse(message, status) { var e = new Error(message); e.status = status || 400; return e; }

/** A unit's full name ("xeplr-bi-api" → "xeplr-bi-api.service"), or an error naming what is wrong. */
function unitName(name) {
  var n = String(name || '').trim();
  if (!UNIT.test(n)) throw refuse('"' + n + '" is not a service name: letters, digits and @ . _ : - only');
  return /\.(service|socket|timer|target|path|mount)$/.test(n) ? n : n + '.service';
}

/** Whether a unit matches one of the allowed patterns ("xeplr-*"; * matches anything). */
function allowed(unit, patterns) {
  return (patterns || []).some(function(p) {
    var re = new RegExp('^' + p.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(unit) || re.test(unit.replace(/\.service$/, ''));
  });
}

function run(bin, args, useSudo, limitMs) {
  return new Promise(function(resolve, reject) {
    var file = useSudo ? 'sudo' : bin;
    var argv = useSudo ? ['-n', bin].concat(args) : args;
    execFile(file, argv, { timeout: limitMs, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' }, function(err, stdout, stderr) {
      if (err) {
        var said = String(stderr || '').trim() || err.message;
        if (err.killed) said = 'No answer within ' + Math.round(limitMs / 1000) + ' seconds';
        else if (/a password is required|sudo: a terminal is required/.test(said)) said = 'sudo refused: the monitor\'s user may not run "' + bin + ' ' + args.join(' ') + '" without a password. See deploy/sudoers.example';
        else if (err.code === 'ENOENT') said = file + ' is not installed here: the monitor controls systemd services, on Linux';
        return reject(Object.assign(new Error(said), { status: 502, stdout: stdout }));
      }
      resolve(String(stdout));
    });
  });
}

function number(v) {
  if (v === undefined || v === '' || v === '[not set]' || v === '18446744073709551615') return null;
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Asked for as --timestamp=unix ("@1762871581"), so the server's time zone
// never has to be guessed from "Tue 2026-11-11 16:53:01 IST".
function when(v) {
  if (!v || v === 'n/a' || v === '0') return null;
  var m = /^@(\d+)/.exec(v);
  if (m) return Number(m[1]) ? new Date(Number(m[1]) * 1000).toISOString() : null;
  var d = new Date(v.replace(/^\w{3} /, ''));
  return isNaN(d) ? v : d.toISOString();
}

/** What systemd says about a unit now. */
async function status(unit) {
  var out = await run(cfg.systemctl, ['show', unit, '--no-pager', '--timestamp=unix', '--property=' + PROPS.join(',')], false, READ_LIMIT_MS);
  var p = {};
  out.split('\n').forEach(function(line) { var i = line.indexOf('='); if (i > 0) p[line.slice(0, i)] = line.slice(i + 1); });
  var active = p.ActiveState || 'unknown';
  return {
    unit: unit,
    description: p.Description || '',
    exists: p.LoadState !== 'not-found',
    loadState: p.LoadState || null,
    state: active,                       // active | inactive | failed | activating | deactivating | reloading
    subState: p.SubState || null,        // running | exited | dead | auto-restart | …
    result: p.Result || null,            // success, or why it last ended (exit-code, signal, timeout, oom-kill …)
    pid: number(p.MainPID) || null,
    restarts: number(p.NRestarts),
    since: active === 'active' || active === 'activating' ? when(p.ActiveEnterTimestamp) : when(p.InactiveEnterTimestamp),
    exitStatus: number(p.ExecMainStatus),
    memoryBytes: number(p.MemoryCurrent),
    cpuSeconds: number(p.CPUUsageNSec) === null ? null : Math.round(number(p.CPUUsageNSec) / 1e7) / 100,
    enabled: p.UnitFileState || null,
    restartPolicy: p.Restart || null
  };
}

/** start | stop | restart | kill (SIGKILL to every process of it). */
async function act(unit, action) {
  if (ACTIONS.indexOf(action) < 0) throw refuse('Unknown action "' + action + '": start, stop, restart or kill');
  var args = action === 'kill' ? ['kill', '--signal=SIGKILL', unit] : [action, unit];
  try {
    await run(cfg.systemctl, args, cfg.sudo !== 'none', ACTION_LIMIT_MS);
  } catch (err) {
    // systemd 255 (Ubuntu 24.04) kills the service, then says it could not
    // signal its "auxiliary processes" even when it has none. Done is done:
    // when the service really went down, the kill worked.
    if (action !== 'kill' || !/auxiliary processes/.test(err.message)) throw err;
    var after = await status(unit);
    if (after.state === 'active' && after.subState === 'running') throw err;
    return after;
  }
  return status(unit);
}

var LEVELS = { 0: 'error', 1: 'error', 2: 'error', 3: 'error', 4: 'warn', 5: 'info', 6: 'info', 7: 'debug' };

/** One journal entry (journalctl -o json) as a log line. */
function lineOf(e) {
  var msg = e.MESSAGE;
  if (Array.isArray(msg)) msg = Buffer.from(msg).toString('utf8'); // not valid UTF-8 as sent: journalctl gives the bytes
  return {
    at: new Date(Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000)).toISOString(),
    level: LEVELS[e.PRIORITY] || 'info',
    pid: e._PID ? Number(e._PID) : null,
    from: e.SYSLOG_IDENTIFIER || e._COMM || null,
    message: msg === undefined || msg === null ? '' : String(msg),
    cursor: e.__CURSOR
  };
}

function parse(out) {
  var rows = [];
  out.split('\n').forEach(function(l) { if (!l) return; try { rows.push(lineOf(JSON.parse(l))); } catch (e) { /* not a journal entry */ } });
  return rows;
}

/**
 * A unit's log lines, oldest first: the last `lines` of them (at most
 * MAX_LINES), between `since` and `until` when given, only those containing
 * `grep` (any case) and at `level` or worse.
 */
async function logs(unit, o) {
  o = o || {};
  var lines = Math.min(Math.max(parseInt(o.lines, 10) || 200, 1), MAX_LINES);
  var filtered = Boolean(o.grep || o.level);
  // A filter is applied here, not by journalctl (whose --grep is not in every
  // build), so read further back to still find `lines` matches.
  var args = ['-u', unit, '-o', 'json', '--no-pager', '-n', String(filtered ? MAX_LINES * 4 : lines)];
  if (o.since) args.push('--since', stamp(o.since, 'since'));
  if (o.until) args.push('--until', stamp(o.until, 'until'));
  var rows = parse(await run(cfg.journalctl, args, cfg.sudo === 'all', READ_LIMIT_MS));
  if (o.grep) { var g = String(o.grep).toLowerCase(); rows = rows.filter(function(r) { return r.message.toLowerCase().indexOf(g) > -1; }); }
  if (o.level) { var worst = rank(o.level); rows = rows.filter(function(r) { return rank(r.level) <= worst; }); }
  return rows.slice(-lines);
}

function rank(level) { return { error: 0, warn: 1, info: 2, debug: 3 }[level] === undefined ? 3 : { error: 0, warn: 1, info: 2, debug: 3 }[level]; }

/** A time journalctl takes: an ISO time, made "YYYY-MM-DD HH:MM:SS" (UTC, said so). */
function stamp(v, name) {
  var d = new Date(v);
  if (isNaN(d)) throw refuse(name + ' is not a time: "' + v + '"');
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Follow a unit's log as it is written: `onLine(line)` for each new line.
 * → stop(). The journalctl process ends with stop() — a page that closes its
 * log ends what it was reading.
 */
function follow(unit, onLine, onEnd) {
  var argv = ['-u', unit, '-o', 'json', '--no-pager', '-f', '-n', '0'];
  var child = cfg.sudo === 'all' ? spawn('sudo', ['-n', cfg.journalctl].concat(argv)) : spawn(cfg.journalctl, argv);
  var rest = '';
  child.stdout.on('data', function(chunk) {
    var text = rest + chunk.toString('utf8');
    var parts = text.split('\n');
    rest = parts.pop();
    parts.forEach(function(l) { if (!l) return; try { onLine(lineOf(JSON.parse(l))); } catch (e) { /* not a journal entry */ } });
  });
  var errText = '';
  child.stderr.on('data', function(c) { errText += c.toString('utf8'); });
  child.on('error', function(e) { if (onEnd) onEnd(e.message); });
  child.on('close', function(code) { if (onEnd && code) onEnd(errText.trim() || 'journalctl ended (' + code + ')'); });
  return function stop() { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
}

/** The unit this process itself runs in (from its cgroup), or null — so the monitor never stops itself. */
function selfUnit() {
  try {
    var cg = fs.readFileSync('/proc/self/cgroup', 'utf8');
    var m = cg.match(/\/([^/\n]+\.service)(\n|$|\/)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

module.exports = { configure: configure, unitName: unitName, allowed: allowed, status: status, act: act, logs: logs, follow: follow, selfUnit: selfUnit, lineOf: lineOf, ACTIONS: ACTIONS, MAX_LINES: MAX_LINES };
