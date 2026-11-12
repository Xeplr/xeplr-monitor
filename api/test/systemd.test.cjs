// A REAL SERVICE, controlled through lib/systemd: a small unit is written into
// /run/systemd/system, then read (status, what runs it, memory against its
// limit, CPU %, every process), restarted, killed, stopped and started, and
// its log read, searched and followed live. Needs Linux with systemd and
// passwordless sudo (GitHub's ubuntu runners have both); skipped elsewhere,
// saying why. Removed after. The routes and sign-in around it are checked by
// the deploy test against a real server (deploy/README.md).
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFileSync } = require('child_process');
var systemd = require('../lib/systemd');

function why() {
  if (process.platform !== 'linux') return 'not Linux';
  if (!fs.existsSync('/run/systemd/system')) return 'systemd is not running here';
  try { execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' }); } catch (e) { return 'no passwordless sudo'; }
  return null;
}
var skip = why();
if (skip) console.log('  skipped: needs Linux with systemd and passwordless sudo (' + skip + ')');

function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

test('a real service: read, followed, restarted, killed, stopped, started', { skip: skip || false, timeout: 120000 }, async function() {
  var unit = 'xeplr-monitortest-' + Date.now().toString(36) + '.service';
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-monitor-sd-'));
  var script = path.join(dir, 'tick.js');
  fs.writeFileSync(script, "require('child_process').spawn('sleep', ['300'], { stdio: 'ignore' }); var n = 0; console.log('started ' + process.pid); setInterval(function() { console.log('tick ' + (++n)); if (n % 5 === 0) console.error('every FIFTH tick is a warning'); }, 200);\n");
  execFileSync('sudo', ['-n', 'tee', '/run/systemd/system/' + unit], { input: '[Unit]\nDescription=xeplr-monitor test service\n[Service]\nExecStart=' + process.execPath + ' ' + script + '\nWorkingDirectory=' + dir + '\nMemoryMax=200M\nRestart=no\n', stdio: ['pipe', 'ignore', 'inherit'] });
  execFileSync('sudo', ['-n', 'systemctl', 'daemon-reload']);
  systemd.configure({ sudo: 'all' });
  try {
    assert.equal((await systemd.status(unit)).state, 'inactive');
    var started = await systemd.act(unit, 'start');
    assert.equal(started.state, 'active');
    var pid1 = started.pid;

    await wait(1500);
    await systemd.status(unit);
    await wait(1200);
    var st = await systemd.status(unit);
    var procs = systemd.processes(st);
    assert.equal(st.runs.commands[0].command, process.execPath + ' ' + script, 'the command it runs');
    assert.equal(st.runs.workingDirectory, dir);
    assert.equal(st.memoryMaxBytes, 200 * 1024 * 1024, 'its memory limit');
    assert.equal(typeof st.cpuPercent, 'number', 'CPU % from two readings');
    assert.equal(procs.length, 2, 'node and its child: ' + JSON.stringify(procs));
    assert.equal(procs[0].pid, pid1, 'the main process first');
    assert.equal(procs[1].command, 'sleep 300');
    assert.equal(procs[1].parent, pid1);

    var got = await new Promise(function(resolve) {
      var stop = systemd.follow(unit, function(line) { if (/^tick \d+$/.test(line.message)) { stop(); resolve(line); } });
      setTimeout(function() { stop(); resolve(null); }, 10000);
    });
    assert.ok(got, 'a new line came through while following');

    var lines = await systemd.logs(unit, { lines: 50 });
    assert.ok(lines.some(function(l) { return /^tick \d+$/.test(l.message); }), 'its output is in its log');
    var found = await systemd.logs(unit, { grep: 'fifth' });
    assert.ok(found.length > 0 && found.every(function(l) { return /FIFTH/.test(l.message); }), 'a search keeps only matching lines, any case');

    var restarted = await systemd.act(unit, 'restart');
    assert.equal(restarted.state, 'active');
    assert.notEqual(restarted.pid, pid1, 'a new process');
    await systemd.act(unit, 'kill');
    await wait(500);
    var after = await systemd.status(unit);
    assert.ok(after.state === 'failed' || after.state === 'inactive', 'killed: ' + after.state);
    assert.equal(after.result, 'signal', 'it says why it ended');
    await systemd.act(unit, 'start');
    assert.equal((await systemd.act(unit, 'stop')).state, 'inactive');
  } finally {
    try { execFileSync('sudo', ['-n', 'systemctl', 'stop', unit], { stdio: 'ignore' }); } catch (e) { /* not running */ }
    try { execFileSync('sudo', ['-n', 'systemctl', 'reset-failed', unit], { stdio: 'ignore' }); } catch (e) { /* not failed */ }
    execFileSync('sudo', ['-n', 'rm', '-f', '/run/systemd/system/' + unit]);
    execFileSync('sudo', ['-n', 'systemctl', 'daemon-reload']);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('names: checked before they reach systemctl, and the allow-list matched', function() {
  assert.equal(systemd.unitName('xeplr-bi-api'), 'xeplr-bi-api.service');
  assert.equal(systemd.unitName('getty@tty1.service'), 'getty@tty1.service');
  ['', 'a b', 'x;reboot', '../etc', '-p'].forEach(function(n) { assert.throws(function() { systemd.unitName(n); }, /is not a service name/, n); });
  assert.ok(systemd.allowed('xeplr-bi-dev-api.service', ['xeplr-*']));
  assert.ok(systemd.allowed('postgresql.service', ['xeplr-*', 'postgresql']));
  assert.ok(!systemd.allowed('sshd.service', ['xeplr-*']));
  assert.ok(!systemd.allowed('xeplr.service.evil', ['xeplr']), 'a pattern matches the whole name');
  var line = systemd.lineOf({ __REALTIME_TIMESTAMP: '1762871581123456', PRIORITY: '3', _PID: '42', MESSAGE: [104, 105], SYSLOG_IDENTIFIER: 'node', __CURSOR: 'c' });
  assert.deepEqual([line.at, line.level, line.pid, line.message], ['2025-11-11T14:33:01.123Z', 'error', 42, 'hi']);
  assert.deepEqual(systemd.commandsOf('{ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/bi/server.js --port 4000 ; ignore_errors=no ; start_time=[n/a] ; pid=0 }'), [{ path: '/usr/bin/node', command: '/usr/bin/node /opt/bi/server.js --port 4000' }]);
});
