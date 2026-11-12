// The API over real HTTP, signed in with a real cookie and a real code: what
// is refused before sign-in, the code step, the lock after wrong tries, the
// header a change needs, the allow-list, and the audit log of all of it.
// Controlling a real service is test/systemd.test.js (Linux only).
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var monitor = require('../index');
var users = require('../lib/users');
var totp = require('@xeplr/utils/lib/totp');

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-monitor-api-'));
var server, base;

test.before(async function() {
  server = await monitor.start({ dataDir: dir, secret: 's'.repeat(40), allow: 'xeplr-*', port: 0, publicDir: path.join(dir, 'no-page') });
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});
test.after(function() { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function call(method, url, body, cookie, noHeader) {
  var headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (!noHeader) headers['x-xeplr-monitor'] = '1';
  return fetch(base + url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(async function(r) {
    return { status: r.status, body: await r.json().catch(function() { return null; }), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  });
}

test('a monitor will not start without its settings, each named', function() {
  assert.throws(function() { monitor.init({ secret: 's'.repeat(40), allow: 'x' }); }, /MONITOR_DATA_DIR is not set/);
  assert.throws(function() { monitor.init({ dataDir: dir, allow: 'x' }); }, /MONITOR_SECRET is not set/);
  assert.throws(function() { monitor.init({ dataDir: dir, secret: 's'.repeat(40) }); }, /MONITOR_ALLOW is not set/);
  assert.deepEqual(monitor.requiredEnv, ['MONITOR_DATA_DIR', 'MONITOR_SECRET', 'MONITOR_ALLOW']);
  monitor.init({ dataDir: dir, secret: 's'.repeat(40), allow: 'xeplr-*' });
});

test('nothing but sign-in answers before signing in', async function() {
  assert.equal((await call('GET', '/services')).status, 401);
  assert.equal((await call('GET', '/audit')).status, 401);
  assert.equal((await call('POST', '/services/xeplr-bi-api/restart')).status, 401);
});

test('signing in: the password, then the code; then a cookie that works', async function() {
  var made = users.add('ops@xeplr.com', 'long enough password');
  var r = await call('POST', '/login', { email: 'ops@xeplr.com', password: 'long enough password' });
  assert.equal(r.status, 401);
  assert.ok(r.body.needsCode, 'the code is asked for');
  assert.equal(r.cookie, '', 'no cookie yet');
  var code = totp.codeAt(made.secret, Math.floor(Date.now() / 30000));
  r = await call('POST', '/login', { email: 'ops@xeplr.com', password: 'long enough password', code: code });
  assert.equal(r.status, 200);
  assert.ok(/^xeplr_monitor=/.test(r.cookie));
  var me = await call('GET', '/me', null, r.cookie);
  assert.equal(me.body.user.email, 'ops@xeplr.com');
  assert.deepEqual(me.body.allowed, ['xeplr-*']);
  assert.deepEqual((await call('GET', '/services', null, r.cookie)).body, [], 'nothing watched yet');

  var noHeader = await call('POST', '/services', { unit: 'xeplr-x' }, r.cookie, true);
  assert.equal(noHeader.status, 403, 'a change without the monitor\'s header is refused (another site cannot add it)');
  var notAllowed = await call('POST', '/services', { unit: 'sshd' }, r.cookie);
  assert.equal(notAllowed.status, 403);
  assert.match(notAllowed.body.error, /sshd.service is not allowed here. The monitor may control xeplr-\*/);
  var badName = await call('POST', '/services', { unit: 'xeplr-x; rm -rf /' }, r.cookie);
  assert.equal(badName.status, 400);
  assert.match(badName.body.error, /is not a service name/);
  assert.equal((await call('POST', '/services/xeplr-nothing/restart', null, r.cookie)).status, 404, 'only a watched service can be controlled');

  var out = await call('POST', '/logout', null, r.cookie);
  assert.equal(out.status, 200);
});

test('wrong tries: five, then that email is locked out', async function() {
  users.add('locked@xeplr.com', 'long enough password', { twoStep: false });
  for (var i = 0; i < 5; i++) assert.equal((await call('POST', '/login', { email: 'locked@xeplr.com', password: 'wrong password ' + i })).status, 401);
  var r = await call('POST', '/login', { email: 'locked@xeplr.com', password: 'long enough password' });
  assert.equal(r.status, 429, 'even the right password, while locked');
  assert.match(r.body.error, /Too many wrong tries. Try again in 15 minutes/);
});

test('every sign-in and every change is in the audit log, refused ones too', async function() {
  users.add('auditor@xeplr.com', 'long enough password', { twoStep: false });
  var r = await call('POST', '/login', { email: 'auditor@xeplr.com', password: 'long enough password' });
  var a = (await call('GET', '/audit', null, r.cookie)).body.entries;
  assert.ok(a.some(function(e) { return e.action === 'sign-in' && e.email === 'auditor@xeplr.com' && e.ok; }));
  assert.ok(a.some(function(e) { return e.action === 'sign-in' && e.email === 'locked@xeplr.com' && !e.ok; }));
  assert.ok(a.some(function(e) { return e.action === 'add' && e.email === 'ops@xeplr.com' && !e.ok && /not allowed/.test(e.error); }));
});

// Last: it locks 127.0.0.1, which every request here comes from.
test('one address: more room than one email, then locked too', async function() {
  var { FAILS, FAILS_PER_ADDRESS } = require('../lib/router');
  var tries = 0, status = 401;
  // A different email each time, so only the address can be what locks.
  while (status === 401 && tries < FAILS_PER_ADDRESS + 1) {
    status = (await call('POST', '/login', { email: 'person' + tries + '@xeplr.com', password: 'wrong password' })).status;
    tries++;
  }
  assert.equal(status, 429, 'the address locks in the end');
  assert.ok(tries > FAILS + 1, 'colleagues on one network do not lock each other out after ' + FAILS + ' (' + tries + ')');
  users.add('colleague@xeplr.com', 'long enough password', { twoStep: false });
  assert.equal((await call('POST', '/login', { email: 'colleague@xeplr.com', password: 'long enough password' })).status, 429, 'for every email');
});

test('through createApp: its headers even on a refusal, no CORS, unknown /api paths gated', async function() {
  var r = await fetch(base + '/services', { headers: { origin: 'https://elsewhere.example' } });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'another site cannot read it');
  var nothing = await fetch(base + '/nothing-here');
  assert.equal(nothing.status, 401, 'an unknown /api path is gated too');
});
