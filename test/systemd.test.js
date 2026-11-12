// A REAL SERVICE, controlled through the API: a small unit is written into
// /run/systemd/system, then watched, read, restarted, killed, stopped and
// started over HTTP, and its log read and followed live. Needs Linux with
// systemd and passwordless sudo (GitHub's ubuntu runners have both); skipped
// elsewhere, saying why. Removed after.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFileSync } = require('child_process');

function why() {
  if (process.platform !== 'linux') return 'not Linux';
  if (!fs.existsSync('/run/systemd/system')) return 'systemd is not running here';
  try { execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' }); } catch (e) { return 'no passwordless sudo'; }
  return null;
}
var skip = why();
if (skip) console.log('  skipped: needs Linux with systemd and passwordless sudo (' + skip + ')');

test('a real service: watched, read, restarted, killed, stopped, started, followed', { skip: skip || false, timeout: 120000 }, async function() {
  var monitor = require('../index');
  var users = require('../lib/users');
  var name = 'xeplr-monitortest-' + Date.now().toString(36);
  var unit = name + '.service';
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-monitor-sd-'));
  var script = path.join(dir, 'tick.js');
  fs.writeFileSync(script, "require('child_process').spawn('sleep', ['300'], { stdio: 'ignore' }); var n = 0; console.log('started ' + process.pid); setInterval(function() { console.log('tick ' + (++n)); if (n % 5 === 0) console.error('every fifth tick is a warning'); }, 200);\n");
  var unitText = '[Unit]\nDescription=xeplr-monitor test service\n[Service]\nExecStart=' + process.execPath + ' ' + script + '\nWorkingDirectory=' + dir + '\nMemoryMax=200M\nRestart=no\n';
  execFileSync('sudo', ['-n', 'tee', '/run/systemd/system/' + unit], { input: unitText, stdio: ['pipe', 'ignore', 'inherit'] });
  execFileSync('sudo', ['-n', 'systemctl', 'daemon-reload']);
  var server;
  try {
    server = await monitor.start({ dataDir: dir, secret: 's'.repeat(40), allow: 'xeplr-monitortest-*', sudo: 'all', port: 0, publicDir: path.join(dir, 'none') });
    var base = 'http://127.0.0.1:' + server.address().port + '/api';
    users.add('ops@xeplr.com', 'long enough password', { twoStep: false });
    var login = await fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ops@xeplr.com', password: 'long enough password' }) });
    var cookie = login.headers.get('set-cookie').split(';')[0];
    var call = async function(method, url, body) {
      var r = await fetch(base + url, { method: method, headers: { cookie: cookie, 'x-xeplr-monitor': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    };
    var wait = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

    var nope = await call('POST', '/services', { unit: name + '-missing' });
    assert.equal(nope.status, 404, 'a unit systemd does not have is refused');
    var added = await call('POST', '/services', { unit: name, label: 'Ticker' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.unit, unit);

    var list = (await call('GET', '/services')).body;
    assert.equal(list[0].status.state, 'inactive', 'added, not started');

    var started = await call('POST', '/services/' + unit + '/start');
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.status.state, 'active');
    var pid1 = started.body.status.pid;
    assert.ok(pid1 > 0);

    // How it is doing: what runs it, its memory against its limit, CPU, and every process of it.
    await wait(1500);
    (await call('GET', '/services'));
    await wait(1200);
    var one = (await call('GET', '/services')).body[0];
    var st = one.status;
    assert.equal(st.runs.commands[0].command, process.execPath + ' ' + script, 'the command it runs');
    assert.equal(st.runs.workingDirectory, dir);
    assert.ok(st.runs.unitFile.endsWith(unit));
    assert.equal(st.memoryMaxBytes, 200 * 1024 * 1024, 'its memory limit');
    assert.ok(st.memoryBytes > 0 && st.tasks >= 2, JSON.stringify(st));
    assert.equal(typeof st.cpuPercent, 'number', 'CPU % from two readings');
    assert.equal(one.processes.length, 2, 'node and its child: ' + JSON.stringify(one.processes));
    assert.equal(one.processes[0].pid, pid1, 'the main process first');
    assert.match(one.processes[0].command, /tick\.js/);
    assert.equal(one.processes[1].command, 'sleep 300');
    assert.equal(one.processes[1].parent, pid1);
    assert.ok(one.processes[0].memoryBytes > 1024 * 1024 && one.processes[0].threads >= 1 && one.processes[0].startedAt);

    // Followed live: lines arrive as they are written.
    var ctl = new AbortController();
    var res = await fetch(base + '/services/' + unit + '/logs/live', { headers: { cookie: cookie }, signal: ctl.signal });
    var reader = res.body.getReader();
    var got = '';
    var deadline = Date.now() + 10000;
    while (!/"message":"tick \d+"/.test(got) && Date.now() < deadline) { var c = await reader.read(); if (c.done) break; got += Buffer.from(c.value).toString('utf8'); }
    ctl.abort();
    assert.match(got, /"message":"tick \d+"/, 'a new line came through while following');

    await wait(1500);
    var logs = (await call('GET', '/services/' + unit + '/logs?lines=50')).body.lines;
    assert.ok(logs.some(function(l) { return /^tick \d+$/.test(l.message); }), 'its output is in its log');
    var warnings = (await call('GET', '/services/' + unit + '/logs?grep=FIFTH')).body.lines;
    assert.ok(warnings.length > 0 && warnings.every(function(l) { return /fifth/.test(l.message); }), 'a search keeps only the lines containing it, any case');

    var restarted = await call('POST', '/services/' + unit + '/restart');
    assert.equal(restarted.body.status.state, 'active');
    assert.notEqual(restarted.body.status.pid, pid1, 'a new process');

    var killed = await call('POST', '/services/' + unit + '/kill');
    assert.equal(killed.status, 200, JSON.stringify(killed.body));
    await wait(500);
    var after = (await call('GET', '/services')).body[0].status;
    assert.ok(after.state === 'failed' || after.state === 'inactive', 'killed: ' + after.state);
    assert.equal(after.result, 'signal', 'it says why it ended');

    await call('POST', '/services/' + unit + '/start');
    var stopped = await call('POST', '/services/' + unit + '/stop');
    assert.equal(stopped.body.status.state, 'inactive');

    var renamed = await call('PATCH', '/services/' + unit, { label: 'Ticker two' });
    assert.equal(renamed.body.label, 'Ticker two', 'changed in place');
    var audit = (await call('GET', '/audit')).body.entries.map(function(e) { return e.action; });
    ['add', 'start', 'restart', 'kill', 'stop', 'edit'].forEach(function(a) { assert.ok(audit.indexOf(a) > -1, a + ' is in the audit log'); });
    assert.equal((await call('DELETE', '/services/' + unit)).status, 200);
  } finally {
    if (server) server.close();
    try { execFileSync('sudo', ['-n', 'systemctl', 'stop', unit], { stdio: 'ignore' }); } catch (e) { /* not running */ }
    try { execFileSync('sudo', ['-n', 'systemctl', 'reset-failed', unit], { stdio: 'ignore' }); } catch (e) { /* not failed */ }
    execFileSync('sudo', ['-n', 'rm', '-f', '/run/systemd/system/' + unit]);
    execFileSync('sudo', ['-n', 'systemctl', 'daemon-reload']);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('names: checked before they reach systemctl, and the allow-list matched', function() {
  var systemd = require('../lib/systemd');
  assert.equal(systemd.unitName('xeplr-bi-api'), 'xeplr-bi-api.service');
  assert.equal(systemd.unitName('getty@tty1.service'), 'getty@tty1.service');
  ['', 'a b', 'x;reboot', '../etc', '-p'].forEach(function(n) { assert.throws(function() { systemd.unitName(n); }, /is not a service name/, n); });
  assert.ok(systemd.allowed('xeplr-bi-dev-api.service', ['xeplr-*']));
  assert.ok(systemd.allowed('postgresql.service', ['xeplr-*', 'postgresql']));
  assert.ok(!systemd.allowed('sshd.service', ['xeplr-*']));
  assert.ok(!systemd.allowed('xeplr.service.evil', ['xeplr']), 'a pattern matches the whole name');
  var line = systemd.lineOf({ __REALTIME_TIMESTAMP: '1762871581123456', PRIORITY: '3', _PID: '42', MESSAGE: [104, 105], SYSLOG_IDENTIFIER: 'node', __CURSOR: 'c' });
  assert.deepEqual([line.at, line.level, line.pid, line.message], ['2025-11-11T14:33:01.123Z', 'error', 42, 'hi'], 'a journal entry: its time, level, and bytes made text');
});
