// THE SERVICES THE MONITOR WATCHES — added by hand, kept in services.json.
// A service is only ever controlled once it is on this list, and only if its
// unit matches MONITOR_ALLOW (e.g. "xeplr-*"): the list is what you chose to
// watch, the pattern is what the server owner allows at all. sudoers repeats
// the pattern, so even a bug here could not reach another unit.
var store = require('./store');
var systemd = require('./systemd');

var FILE = 'services.json';
var patterns = [];

function setAllowed(list) {
  var p = (Array.isArray(list) ? list : String(list || '').split(',')).map(function(x) { return x.trim(); }).filter(Boolean);
  if (!p.length) throw new Error('MONITOR_ALLOW is not set: the services the monitor may control, e.g. "xeplr-*" (comma-separated, * matches anything)');
  patterns = p;
}

function allowedPatterns() { return patterns.slice(); }

function refuse(message, status) { var e = new Error(message); e.status = status || 400; return e; }

function all() { return store.read(FILE, []); }

/** One watched service by its unit, or a 404. */
function get(unit) {
  var s = all().find(function(x) { return x.unit === unit; });
  if (!s) throw refuse('"' + unit + '" is not one of the services the monitor watches', 404);
  return s;
}

/** A unit checked: a proper name, allowed, and known to systemd. → its full name. */
async function checked(name) {
  var unit = systemd.unitName(name);
  if (!systemd.allowed(unit, patterns)) throw refuse(unit + ' is not allowed here. The monitor may control ' + patterns.join(', ') + ' (MONITOR_ALLOW)', 403);
  var st = await systemd.status(unit);
  if (!st.exists) throw refuse('systemd has no service called ' + unit + ' on this server', 404);
  return unit;
}

/** Watch a service: { unit, label }. */
async function add(body, by) {
  var unit = await checked(body && body.unit);
  var list = all();
  if (list.some(function(x) { return x.unit === unit; })) throw refuse(unit + ' is already on the list', 409);
  var s = { unit: unit, label: String((body && body.label) || '').trim().slice(0, 80) || unit.replace(/\.service$/, ''), addedBy: by, addedAt: new Date().toISOString() };
  list.push(s);
  store.write(FILE, list);
  return s;
}

/** Change a watched service in place: its label, or which unit it is. */
async function edit(unit, body, by) {
  var list = all();
  var s = list.find(function(x) { return x.unit === unit; });
  if (!s) throw refuse('"' + unit + '" is not one of the services the monitor watches', 404);
  if (body.unit !== undefined && systemd.unitName(body.unit) !== unit) {
    var next = await checked(body.unit);
    if (list.some(function(x) { return x.unit === next; })) throw refuse(next + ' is already on the list', 409);
    s.unit = next;
  }
  if (body.label !== undefined) s.label = String(body.label).trim().slice(0, 80) || s.unit.replace(/\.service$/, '');
  s.changedBy = by;
  s.changedAt = new Date().toISOString();
  store.write(FILE, list);
  return s;
}

/** Stop watching a service. The service itself is not touched. */
function remove(unit) {
  var list = all();
  var left = list.filter(function(x) { return x.unit !== unit; });
  if (left.length === list.length) throw refuse('"' + unit + '" is not one of the services the monitor watches', 404);
  store.write(FILE, left);
}

module.exports = { setAllowed: setAllowed, allowedPatterns: allowedPatterns, all: all, get: get, add: add, edit: edit, remove: remove };
