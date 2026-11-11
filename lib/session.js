// SIGNED-IN SESSIONS — a signed cookie, nothing stored. The cookie holds the
// email, when it expires and the user's sessionVersion; it is signed with
// MONITOR_SECRET, so it cannot be made or changed without it. A changed
// password bumps sessionVersion, which signs that user out everywhere.
//
// Cookie: httpOnly (no script reads it), SameSite=Strict (another site cannot
// send it), Secure behind https. Every request that changes something must
// also carry the header x-xeplr-monitor: 1, which a form on another site
// cannot add.
var crypto = require('crypto');
var users = require('./users');

var COOKIE = 'xeplr_monitor';
var HOURS = 12;
var secret = null;

function setSecret(s) {
  if (!s) throw new Error('MONITOR_SECRET is not set: it signs the monitor\'s sign-in cookies');
  if (String(s).length < 32) throw new Error('MONITOR_SECRET must be at least 32 characters (it is ' + String(s).length + ')');
  secret = String(s);
}

function sign(body) { return crypto.createHmac('sha256', secret).update(body).digest('base64url'); }

/** A new session's cookie value for a user. */
function issue(u, now) {
  var body = Buffer.from(JSON.stringify({ e: u.email, x: (now || Date.now()) + HOURS * 3600000, v: u.sessionVersion || 1 })).toString('base64url');
  return body + '.' + sign(body);
}

/** The signed-in user a cookie value belongs to, or null. */
function read(value, now) {
  if (!value || value.indexOf('.') < 0) return null;
  var parts = value.split('.');
  var want = Buffer.from(sign(parts[0]));
  var got = Buffer.from(parts[1] || '');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  var data;
  try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!data || data.x < (now || Date.now())) return null;
  var u = users.find(data.e);
  if (!u || (u.sessionVersion || 1) !== data.v) return null;
  return u;
}

function cookieOf(req) {
  var header = req.headers.cookie || '';
  var found = header.split(';').map(function(c) { return c.trim(); }).find(function(c) { return c.indexOf(COOKIE + '=') === 0; });
  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null;
}

function setCookie(req, res, value, maxAgeSeconds) {
  var parts = [COOKIE + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAgeSeconds];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function start(req, res, u) { setCookie(req, res, issue(u), HOURS * 3600); }
function end(req, res) { setCookie(req, res, '', 0); }

/** Express middleware: the signed-in user on req.user, else 401. Changes need the monitor's own header. */
function required(req, res, next) {
  var u = read(cookieOf(req));
  if (!u) return res.status(401).json({ error: 'Sign in first' });
  if (req.method !== 'GET' && req.headers['x-xeplr-monitor'] !== '1') return res.status(403).json({ error: 'Missing the x-xeplr-monitor header' });
  req.user = u;
  next();
}

module.exports = { setSecret: setSecret, issue: issue, read: read, cookieOf: cookieOf, start: start, end: end, required: required, COOKIE: COOKIE };
