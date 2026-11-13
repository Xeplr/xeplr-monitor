// The auth catalog, built from this app's migrations-auth: every route the
// monitor checks with requireApi has its `apis` row, every such row has a
// group, and every group goes to a role besides Super Admin — an API granted
// to Super Admin alone is refused to everyone else, and nobody finds out until
// a screen stops working.
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');

var dir = path.join(__dirname, '..', 'migrations-auth');
var sql = fs.readdirSync(dir).filter(function(f) { return /\.sql$/.test(f); }).sort().map(function(f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n');

// INSERT INTO "apis" … FROM (VALUES ('name', 'group'), …): the rows.
function apiRows() {
  var rows = [];
  var re = /INSERT INTO "apis"[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v/g;
  var m;
  while ((m = re.exec(sql))) {
    var pair = /\(\s*'((?:[^']|'')*)'\s*,\s*'([^']*)'(?:\s*,\s*(true|false))?\s*\)/g;
    var p;
    while ((p = pair.exec(m[1]))) rows.push({ name: p[1].replace(/''/g, "'"), group: p[2], isPublic: p[3] === 'true' });
  }
  return rows;
}

// WITH grants(role, "group") AS (VALUES ('Role', 'group'), …): who gets what.
function grants() {
  var out = [];
  var re = /WITH grants\(role, "group"\) AS \(VALUES([\s\S]*?)\n\)/g;
  var m;
  while ((m = re.exec(sql))) {
    var pair = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
    var p;
    while ((p = pair.exec(m[1]))) out.push({ role: p[1], group: p[2] });
  }
  return out;
}

test('every route the monitor checks has its apis row', function() {
  var names = apiRows().map(function(r) { return r.name; });
  [['routes/monitor.js', require('../routes/monitor').API], ['@xeplr/backups', require('@xeplr/backups').API]].forEach(function(pair) {
    Object.keys(pair[1]).forEach(function(k) {
      assert.ok(names.indexOf(pair[1][k]) > -1, pair[0] + ' checks "' + pair[1][k] + '", which no migrations-auth file inserts');
    });
  });
});

test('every non-public api has a group and a role besides Super Admin', function() {
  var rows = apiRows();
  assert.ok(rows.length >= 9, 'the monitor\'s apis rows were found (' + rows.length + ')');
  var g = grants();
  rows.filter(function(r) { return !r.isPublic; }).forEach(function(r) {
    assert.ok(r.group, '"' + r.name + '" has no group');
    var roles = g.filter(function(x) { return x.group === r.group; }).map(function(x) { return x.role; });
    assert.ok(roles.some(function(x) { return x !== 'Super Admin'; }), '"' + r.name + '" (' + r.group + ') is granted to Super Admin alone');
    assert.ok(roles.indexOf('Super Admin') > -1 && roles.indexOf('CompanyAdmin') > -1, '"' + r.name + '": Super Admin and the company admin role get everything');
  });
});

test('every side-rail key has its menu row', function() {
  var app = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'src', 'App.jsx'), 'utf8');
  var drawer = app.slice(app.indexOf('const drawerItems'), app.indexOf('], [navigate'));
  var keys = (drawer.match(/key: '([^']+)'/g) || []).map(function(k) { return k.slice(6, -1); });
  assert.deepEqual(keys, ['Home', 'Monitor', 'Jobs', 'Backup connections']);
  // Jobs' menu row is @xeplr/jobs' own (its migrations-auth, run alongside).
  var jobsSql = fs.readdirSync(path.join(path.dirname(require.resolve('@xeplr/jobs')), 'migrations-auth')).map(function(f) { return fs.readFileSync(path.join(path.dirname(require.resolve('@xeplr/jobs')), 'migrations-auth', f), 'utf8'); }).join('\n');
  keys.forEach(function(k) {
    // @xeplr/ui-account drops a key with no menu row silently.
    assert.ok(new RegExp("INSERT INTO \"menus\"[\\s\\S]*?'" + k + "', '[a-z]+:view'").test(sql + jobsSql), 'no menu row named "' + k + '" in migrations-auth');
  });
});
