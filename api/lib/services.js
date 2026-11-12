// THE SERVICES THE MONITOR WATCHES — rows of monitor_services, added by hand.
// A service is only ever controlled once it is on this list, and only if its
// unit matches MONITOR_ALLOW (e.g. "xeplr-*"): the list is what someone chose
// to watch, the pattern is what the server owner allows at all. sudoers
// repeats the pattern, so even a bug here could not reach another unit.
var { generateId } = require('@xeplr/utils');
var systemd = require('./systemd');
var { MonitoredService, MonitorAudit } = require('../models');

var patterns = [];

/** MONITOR_ALLOW, read once at startup. Required (env.required.js). */
function setAllowed(list) {
  var p = (Array.isArray(list) ? list : String(list || '').split(',')).map(function(x) { return x.trim(); }).filter(Boolean);
  if (!p.length) throw new Error('MONITOR_ALLOW is not set: the services the monitor may control, e.g. "xeplr-*" (comma-separated, * matches anything)');
  patterns = p;
}

function allowedPatterns() { return patterns.slice(); }

function refuse(message, status) { var e = new Error(message); e.status = status || 400; return e; }

function all() { return MonitoredService.query().orderBy('label'); }

/** One watched service by its unit, or a 404. */
async function get(unit) {
  var s = await MonitoredService.query().findOne({ unit: unit });
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
  if (await MonitoredService.query().findOne({ unit: unit })) throw refuse(unit + ' is already on the list', 409);
  var label = String((body && body.label) || '').trim().slice(0, 80) || unit.replace(/\.service$/, '');
  return MonitoredService.query().insert({ id: generateId(), unit: unit, label: label, addedBy: by });
}

/** Change a watched service in place: its label, or which unit it is. */
async function edit(unit, body) {
  var s = await get(unit);
  var patch = {};
  if (body.unit !== undefined && systemd.unitName(body.unit) !== unit) {
    var next = await checked(body.unit);
    if (await MonitoredService.query().findOne({ unit: next })) throw refuse(next + ' is already on the list', 409);
    patch.unit = next;
  }
  if (body.label !== undefined) patch.label = String(body.label).trim().slice(0, 80) || (patch.unit || unit).replace(/\.service$/, '');
  return Object.keys(patch).length ? MonitoredService.query().patchAndFetchById(s.id, patch) : s;
}

/** Stop watching a service. The service itself is not touched. */
async function remove(unit) {
  var s = await get(unit);
  await MonitoredService.query().deleteById(s.id);
}

/** One line of the audit log. Never throws: a failed write must not turn a done action into an error. */
async function audit(entry) {
  try {
    await MonitorAudit.query().insert({ id: generateId(), email: entry.email || null, ip: entry.ip || null, action: entry.action, unit: entry.unit || null, ok: Boolean(entry.ok), error: entry.error || null });
  } catch (e) { console.error('[monitor] audit not written:', e.message); }
}

async function recentAudit(limit) {
  var rows = await MonitorAudit.query().orderBy('recordCreatedDate', 'desc').limit(Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000));
  return rows.map(function(r) { return { at: new Date(r.recordCreatedDate).toISOString(), email: r.email, ip: r.ip, action: r.action, unit: r.unit, ok: r.ok, error: r.error }; });
}

module.exports = { setAllowed: setAllowed, allowedPatterns: allowedPatterns, all: all, get: get, add: add, edit: edit, remove: remove, audit: audit, recentAudit: recentAudit };
