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
  'ActiveEnterTimestamp', 'InactiveEnterTimestamp', 'ExecMainStatus', 'MemoryCurrent', 'CPUUsageNSec', 'UnitFileState', 'Restart',
  // what runs it, and what it may use
  'ExecStart', 'WorkingDirectory', 'User', 'FragmentPath', 'ControlGroup',
  'MemoryPeak', 'MemoryMax', 'MemoryHigh', 'MemorySwapCurrent', 'TasksCurrent', 'TasksMax'];
var MAX_PROCESSES = 200;
var TICKS = 100; // USER_HZ: /proc counts CPU time in 1/100 s on every Linux the monitor runs on

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

// CPU % needs two readings: the last one per unit (and per process), so each
// poll says how busy it was since the one before. Above 100 means more than
// one core.
var lastCpu = new Map();

function cpuPercent(map, key, used, at) {
  var prev = map.get(key);
  if (used === null) return null;
  if (prev && at - prev.at < 1000) return prev.percent;
  var percent = prev && used >= prev.used ? Math.round((used - prev.used) / (at - prev.at) * 1000) / 10 : null;
  map.set(key, { used: used, at: at, percent: percent });
  return percent;
}

/**
 * The commands a unit runs, from systemctl's ExecStart:
 * "{ path=/usr/bin/node ; argv[]=/usr/bin/node server.js ; ignore_errors=no ; … }".
 * The same line `ps` shows, so nothing here is more private than that.
 */
function commandsOf(v) {
  var out = [];
  var re = /path=([^ ;]+) ; argv\[\]=(.*?) ; (?:ignore_errors|flags)=/g;
  var m;
  while ((m = re.exec(v || ''))) out.push({ path: m[1], command: m[2] });
  return out;
}

/** What systemd says about a unit now. */
async function status(unit) {
  var out = await run(cfg.systemctl, ['show', unit, '--no-pager', '--timestamp=unix', '--property=' + PROPS.join(',')], false, READ_LIMIT_MS);
  var p = {};
  out.split('\n').forEach(function(line) { var i = line.indexOf('='); if (i > 0) p[line.slice(0, i)] = line.slice(i + 1); });
  var active = p.ActiveState || 'unknown';
  var nsec = number(p.CPUUsageNSec);
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
    memoryPeakBytes: number(p.MemoryPeak),        // systemd 255+; null before
    memoryMaxBytes: number(p.MemoryMax),          // null: no limit
    memoryHighBytes: number(p.MemoryHigh),
    swapBytes: number(p.MemorySwapCurrent),
    cpuSeconds: nsec === null ? null : Math.round(nsec / 1e7) / 100,
    cpuPercent: active === 'active' ? cpuPercent(lastCpu, unit, nsec === null ? null : nsec / 1e6, Date.now()) : null,
    tasks: number(p.TasksCurrent),                // threads, every process together
    tasksMax: number(p.TasksMax),
    enabled: p.UnitFileState || null,
    restartPolicy: p.Restart || null,
    runs: {
      commands: commandsOf(p.ExecStart),
      workingDirectory: p.WorkingDirectory && p.WorkingDirectory !== '!' ? p.WorkingDirectory.replace(/^!/, '') : null,
      user: p.User || 'root',
      unitFile: p.FragmentPath || null
    },
    cgroup: p.ControlGroup || null
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

// ── its processes ─────────────────────────────────────────────────────────
var lastProcCpu = new Map();
var bootAt = null;

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }

/** Every pid in a cgroup and the ones under it (cgroup v2, or v1's systemd tree). */
function pidsIn(cgroup) {
  var roots = ['/sys/fs/cgroup' + cgroup, '/sys/fs/cgroup/systemd' + cgroup];
  for (var i = 0; i < roots.length; i++) {
    if (readText(roots[i] + '/cgroup.procs') === null) continue;
    var pids = [];
    (function walk(dir, depth) {
      (readText(dir + '/cgroup.procs') || '').split('\n').forEach(function(x) { if (x) pids.push(Number(x)); });
      if (depth > 4) return;
      var kids = [];
      try { kids = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { /* none */ }
      kids.forEach(function(k) { if (k.isDirectory()) walk(dir + '/' + k.name, depth + 1); });
    })(roots[i], 0);
    return pids;
  }
  return [];
}

/** One process from /proc: what it runs, its memory, CPU and threads. null once it is gone. */
function processOf(pid, at) {
  var stat = readText('/proc/' + pid + '/stat');
  if (!stat) return null;
  // The name is in brackets and may hold spaces or brackets itself: the fields start after the last ")".
  var f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  var status = readText('/proc/' + pid + '/status') || '';
  var kb = function(key) { var m = new RegExp('^' + key + ':\\s+(\\d+) kB', 'm').exec(status); return m ? Number(m[1]) * 1024 : null; };
  var cmd = (readText('/proc/' + pid + '/cmdline') || '').split('\0').filter(Boolean).join(' ');
  var name = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
  if (bootAt === null) { var b = /^btime (\d+)/m.exec(readText('/proc/stat') || ''); bootAt = b ? Number(b[1]) * 1000 : 0; }
  var cpuMs = (Number(f[11]) + Number(f[12])) * 1000 / TICKS;
  return {
    pid: pid,
    parent: Number(f[1]),
    name: name,
    command: cmd || '[' + name + ']',
    state: f[0],                                  // R running, S sleeping, D waiting on disk, Z zombie
    memoryBytes: kb('VmRSS'),
    swapBytes: kb('VmSwap'),
    threads: Number(f[17]),
    cpuSeconds: Math.round(cpuMs / 10) / 100,
    cpuPercent: cpuPercent(lastProcCpu, pid + ':' + f[19], cpuMs, at),
    startedAt: bootAt ? new Date(bootAt + Number(f[19]) * 1000 / TICKS).toISOString() : null
  };
}

/**
 * Every process of a unit, the main one first, then by memory, from the
 * status already read (its cgroup and main pid). Read from the cgroup and
 * /proc, which any user may read: no sudo. Linux only; elsewhere an empty list.
 */
function processes(st) {
  var at = Date.now();
  var list = st && st.cgroup ? pidsIn(st.cgroup).slice(0, MAX_PROCESSES).map(function(pid) { return processOf(pid, at); }).filter(Boolean) : [];
  list.sort(function(a, b) { return (b.pid === st.pid) - (a.pid === st.pid) || (b.memoryBytes || 0) - (a.memoryBytes || 0); });
  return list;
}

/** Forget the CPU readings of processes that are gone. */
function forgetGone(alive) {
  lastProcCpu.forEach(function(v, key) { if (!alive.has(Number(key.split(':')[0]))) lastProcCpu.delete(key); });
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

module.exports = { configure: configure, unitName: unitName, allowed: allowed, status: status, act: act, processes: processes, forgetGone: forgetGone, commandsOf: commandsOf, logs: logs, follow: follow, selfUnit: selfUnit, lineOf: lineOf, ACTIONS: ACTIONS, MAX_LINES: MAX_LINES };
