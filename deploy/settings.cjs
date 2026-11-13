// THE SERVER'S production.env — written by deploy/install.sh, on the server.
//
//   node deploy/settings.cjs <release>/api      (values from XM_* in the environment)
//
// Kept, never remade: ENCRYPTION_KEY and AUTH_JWT_SECRET (made here the first
// time — remaking them would sign everyone out and make the stored database
// login unreadable), the database login when no new one is given, and the
// Super Admin password when no new one is given. Everything else is written
// from this deploy's answers, so a re-deploy with a changed answer changes it.
//
// The database login is encrypted with @xeplr/utils (the same as `xeplr
// encrypt`), from values passed in the environment, never on a command line.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var apiDir = process.argv[2];
var file = process.env.XM_ENV_FILE;
var { encrypt } = require(path.join(apiDir, 'node_modules', '@xeplr', 'utils', 'isomorphic', 'crypto'));

function read(f) {
  var out = {};
  (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split('\n').forEach(function(line) {
    var m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

function need(name) {
  var v = process.env[name];
  if (v === undefined || v === '') throw new Error(name + ' is empty');
  return v;
}

async function main() {
  var was = read(file);
  var e = process.env;
  var key = was.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  var jwt = was.AUTH_JWT_SECRET || crypto.randomBytes(32).toString('hex');

  var connection = was.XEPLR_MONITOR_CONNECTION;
  if (e.XM_DB_HOST) {
    connection = await encrypt(JSON.stringify({ host: e.XM_DB_HOST, port: Number(e.XM_DB_PORT || 5432), user: e.XM_DB_USER, password: e.XM_DB_PASSWORD || '' }), key);
  }
  if (!connection) throw new Error('No database login: this is the first deploy, so the database host, user and password are needed');

  var adminPassword = e.XM_ADMIN_PASSWORD || was.AUTH_SUPER_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('No Super Admin password: this is the first deploy, so one is needed');

  var site = e.XM_DOMAIN ? (e.XM_CERTBOT === '1' ? 'https://' : 'http://') + e.XM_DOMAIN : (was.AUTH_ACTIVATION_URL || '').replace(/\/auth\/activate$/, '');
  var settings = [
    ['NODE_ENV', 'production'],
    ['LOG_DIR', path.join(need('XM_VAR'), 'logs')],
    ['XEPLR_MONITOR_PORT', need('XM_API_PORT')],
    ['AUTH_PORT', need('XM_AUTH_PORT')],
    ['ENCRYPTION_KEY', key],
    // Both name the same server: written together, never one alone.
    ['XEPLR_MONITOR_CONNECTION', connection],
    ['AUTH_DB_CONNECTION_INFO_ENCRYPTED', connection],
    ['DB_API', 'xeplr_monitor_api'],
    // The backup jobs' own database (@xeplr/jobs), and where a dump is written
    // before it goes to S3 (and is then deleted).
    ['DB_JOBS', 'xeplr_monitor_jobs'],
    ['XEPLR_DATA_DIR', path.join(need('XM_VAR'), 'data')],
    ['AUTH_DB_NAME', 'xeplr_monitor_auth'],
    ['REDIS_HOST', e.XM_REDIS_HOST || '127.0.0.1'],
    ['REDIS_PORT', e.XM_REDIS_PORT || '6379'],
    ['REDIS_PASSWORD', e.XM_REDIS_PASSWORD || was.REDIS_PASSWORD || ''],
    ['REDIS_PREFIX', 'xeplr-monitor:'],
    ['AUTH_JWT_SECRET', jwt],
    ['AUTH_URL', 'http://127.0.0.1:' + need('XM_AUTH_PORT')],
    // This app's permissions and the jobs' own (the Jobs page and its routes).
    ['XEPLR_AUTH_MIGRATIONS', './migrations-auth,./node_modules/@xeplr/jobs/migrations-auth'],
    ['AUTH_SUPER_ADMIN_EMAIL', need('XM_ADMIN_EMAIL')],
    ['AUTH_SUPER_ADMIN_PASSWORD', adminPassword],
    ['AUTH_TENANT_HEADER', 'none'],
    ['AUTH_REGISTER_ROLES', 'Viewer'],
    ['AUTH_ACTIVATION_URL', site + '/auth/activate'],
    ['AUTH_INVITE_URL', site + '/auth/accept-invite'],
    ['AUTH_RESET_URL', site + '/auth/reset-password'],
    // The root-owned command sudoers allows (deploy/control.sh, installed by install.sh).
    ['MONITOR_CONTROL_COMMAND', '/usr/local/libexec/xeplr-monitor-control']
  ];
  var known = settings.map(function(s) { return s[0]; });
  // No longer a setting: any service can be watched; roles decide who may.
  delete was.MONITOR_ALLOW;
  // Anything else already in the file (an EMAIL_PROVIDER set by hand, say) stays.
  var extra = Object.keys(was).filter(function(k) { return known.indexOf(k) < 0; }).map(function(k) { return [k, was[k]]; });
  var body = '# Made by xeplr-monitor\'s deploy. Secrets are kept across deploys; other lines\n# are rewritten from its answers. Lines it does not know are kept as they are.\n' +
    settings.concat(extra).map(function(s) { return s[0] + '=' + s[1]; }).join('\n') + '\n';
  fs.writeFileSync(file, body, { mode: 0o640 });
  console.log('  Settings written (' + (was.ENCRYPTION_KEY ? 'secrets kept' : 'secrets made') + (e.XM_DB_HOST ? ', database login set' : ', database login kept') + ')');
}

main().catch(function(err) { console.error('  ' + err.message); process.exit(1); });
