// Who can sign in, on real files: passwords hashed, codes checked, a changed
// password signing every session out. The RFC 6238 test vector proves the
// codes are the ones an authenticator app shows.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var store = require('../lib/store');
var users = require('../lib/users');
var totp = require('../lib/totp');
var session = require('../lib/session');

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeplr-monitor-users-'));
store.open(dir);
session.setSecret('x'.repeat(40));
test.after(function() { fs.rmSync(dir, { recursive: true, force: true }); });

test('codes are the ones RFC 6238 gives (its SHA-1 test vector)', function() {
  // "12345678901234567890" in base32; at 59 seconds the 8-digit code is 94287082.
  assert.equal(totp.codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
  assert.ok(totp.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59000));
  assert.ok(totp.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 89000), 'one step late is still taken');
  assert.ok(!totp.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 200000), 'an old code is not');
  assert.ok(!totp.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'abc'));
});

test('a monitor needs its folder, an absolute one', function() {
  assert.throws(function() { store.open(''); }, /MONITOR_DATA_DIR is not set/);
  assert.throws(function() { store.open('relative/dir'); }, /must be an absolute path/);
  store.open(dir);
});

test('a user: added with a code, checked, wrong tries told apart from nothing', function() {
  assert.throws(function() { users.add('a@b.co', 'short'); }, /at least 12 characters/);
  assert.throws(function() { users.add('not-an-email', 'long enough password'); }, /not an email address/);
  var out = users.add('Ops@Xeplr.com', 'long enough password', { name: 'Ops' });
  assert.equal(out.user.email, 'ops@xeplr.com');
  assert.ok(out.secret && /^otpauth:\/\/totp\//.test(out.url));
  assert.throws(function() { users.add('ops@xeplr.com', 'long enough password'); }, /already a user/);
  var raw = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'))[0];
  assert.ok(/^scrypt\$/.test(raw.hash) && raw.hash.indexOf('long enough') < 0, 'only a hash is kept');

  assert.equal(users.check('ops@xeplr.com', 'wrong password!!').problem, 'Wrong email or password');
  assert.equal(users.check('nobody@xeplr.com', 'long enough password').problem, 'Wrong email or password', 'the same words: which emails exist is not said');
  assert.ok(users.check('ops@xeplr.com', 'long enough password').needsCode, 'right password, no code: the code is asked for');
  assert.ok(users.check('ops@xeplr.com', 'long enough password', '000000').needsCode);
  var code = totp.codeAt(out.secret, Math.floor(Date.now() / 30000));
  assert.equal(users.check('ops@xeplr.com', 'long enough password', code).user.email, 'ops@xeplr.com');
});

test('a session: signed, expiring, and ended by a changed password', function() {
  users.add('second@xeplr.com', 'another long password', { twoStep: false });
  var u = users.find('second@xeplr.com');
  var cookie = session.issue(u);
  assert.equal(session.read(cookie).email, 'second@xeplr.com');
  assert.equal(session.read(cookie.slice(0, -2) + 'xx'), null, 'a changed signature is refused');
  var forged = Buffer.from(JSON.stringify({ e: 'ops@xeplr.com', x: Date.now() + 1e9, v: 1 })).toString('base64url') + '.' + cookie.split('.')[1];
  assert.equal(session.read(forged), null, 'another user\'s name under this signature is refused');
  assert.equal(session.read(cookie, Date.now() + 13 * 3600000), null, 'after 12 hours it has expired');
  users.setPassword('second@xeplr.com', 'a brand new long password');
  assert.equal(session.read(cookie), null, 'the old session is signed out');
  assert.equal(session.read(session.issue(users.find('second@xeplr.com'))).email, 'second@xeplr.com');
  assert.throws(function() { session.setSecret('short'); }, /at least 32 characters/);
});

test('the audit log: appended, read newest first', function() {
  store.audit({ email: 'ops@xeplr.com', action: 'restart', unit: 'a.service', ok: true });
  store.audit({ email: 'ops@xeplr.com', action: 'stop', unit: 'b.service', ok: false, error: 'no' });
  var r = store.recentAudit(10);
  assert.equal(r[0].action, 'stop');
  assert.equal(r[1].action, 'restart');
  assert.ok(r[0].at);
});
