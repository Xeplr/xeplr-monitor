// WHO CAN SIGN IN — the monitor's own list, in users.json, independent of
// every app it controls. If BI's auth service is the thing that is down, a
// monitor that signed in through it could not be used to restart it.
//
// Users are added on the server, never from the web page
// (bin/users.js: xeplr-monitor-users add <email>). Passwords are kept as
// scrypt hashes; a one-time code from an authenticator app is asked for too
// when the user has one (the default for a new user).
var crypto = require('crypto');
var store = require('./store');
var totp = require('./totp');

var FILE = 'users.json';
var SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
var MIN_PASSWORD = 12;

function all() { return store.read(FILE, []); }
function save(list) { store.write(FILE, list); }
function clean(email) { return String(email || '').trim().toLowerCase(); }

function hash(password) {
  var salt = crypto.randomBytes(16);
  var key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function matches(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  var want = Buffer.from(parts[5], 'base64');
  var got = crypto.scryptSync(String(password), Buffer.from(parts[4], 'base64'), want.length, { N: +parts[1], r: +parts[2], p: +parts[3] });
  return crypto.timingSafeEqual(want, got);
}

function passwordProblem(password) {
  if (String(password || '').length < MIN_PASSWORD) return 'The password must be at least ' + MIN_PASSWORD + ' characters';
  return null;
}

// Checked against when the email is unknown, so a wrong email takes as long
// as a wrong password and the timing does not say which emails exist.
var DUMMY = hash(crypto.randomBytes(16).toString('hex'));

/** What a page may see of a user. */
function shown(u) {
  return { email: u.email, name: u.name || u.email, twoStep: Boolean(u.totp), createdAt: u.createdAt };
}

function list() { return all().map(shown); }

function find(email) {
  email = clean(email);
  return all().find(function(u) { return u.email === email; }) || null;
}

/** Add a user. → { user, secret, url } — the secret only when a code is asked for. */
function add(email, password, opts) {
  opts = opts || {};
  email = clean(email);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('"' + email + '" is not an email address');
  var bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  var users = all();
  if (users.some(function(u) { return u.email === email; })) throw new Error(email + ' is already a user');
  var secret = opts.twoStep === false ? null : totp.newSecret();
  var u = { email: email, name: opts.name || email, hash: hash(password), totp: secret, sessionVersion: 1, createdAt: new Date().toISOString() };
  users.push(u);
  save(users);
  return { user: shown(u), secret: secret, url: secret ? totp.otpauthUrl(secret, email) : null };
}

function remove(email) {
  email = clean(email);
  var users = all();
  var left = users.filter(function(u) { return u.email !== email; });
  if (left.length === users.length) throw new Error(email + ' is not a user');
  save(left);
}

/** Change a password. Every session that user has open is signed out. */
function setPassword(email, password) {
  var bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  return change(email, function(u) { u.hash = hash(password); u.sessionVersion = (u.sessionVersion || 1) + 1; });
}

/** A new authenticator secret (or none). Every session that user has open is signed out. */
function setTwoStep(email, on) {
  var secret = on ? totp.newSecret() : null;
  change(email, function(u) { u.totp = secret; u.sessionVersion = (u.sessionVersion || 1) + 1; });
  return { secret: secret, url: secret ? totp.otpauthUrl(secret, clean(email)) : null };
}

function change(email, fn) {
  email = clean(email);
  var users = all();
  var u = users.find(function(x) { return x.email === email; });
  if (!u) throw new Error(email + ' is not a user');
  fn(u);
  save(users);
  return shown(u);
}

/**
 * Check a sign-in. → { user } or { problem, needsCode? }. One message for a
 * wrong email or a wrong password, so the page does not say which emails exist.
 */
function check(email, password, code) {
  var u = find(email);
  var ok = matches(password, u ? u.hash : DUMMY) && Boolean(u);
  if (!ok) return { problem: 'Wrong email or password' };
  if (u.totp) {
    if (!code) return { problem: 'Enter the code from your authenticator app', needsCode: true };
    if (!totp.verify(u.totp, code)) return { problem: 'That code is not right. Codes change every 30 seconds', needsCode: true };
  }
  return { user: u };
}

module.exports = { list: list, find: find, add: add, remove: remove, setPassword: setPassword, setTwoStep: setTwoStep, check: check, shown: shown, MIN_PASSWORD: MIN_PASSWORD };
