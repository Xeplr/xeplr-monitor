#!/usr/bin/env node
// DEPLOY XEPLR-MONITOR TO A SERVER, FROM YOUR LAPTOP — over SSH, asking for
// what it needs as it goes. Nothing is stored: not in this (public)
// repository, not on your laptop. Secrets are made on the server; passwords
// are typed (hidden) and go only to the server, on SSH's input.
//
//   npx -y github:Xeplr/xeplr-monitor                    the latest main
//   npx -y github:Xeplr/xeplr-monitor --ref v1.2.0       a tag
//   node deploy/deploy.js --source .                     this checkout's HEAD (git archive)
//   npx -y github:Xeplr/xeplr-monitor --update --host … --user … --key …
//                                                        a new version, nothing else asked
//
// Anything not given as an argument is asked. Passwords are always asked
// (hidden) — never arguments, which would sit in the shell's history and in
// `ps`. The questions are @xeplr/cli's (the same prompt the app was made with).
//
// On the server, deploy/install.sh runs as root through `sudo -n`, so the SSH
// login needs passwordless sudo (as BI's deploy login has).
var fs = require('fs');
var os = require('os');
var path = require('path');
var { spawn, execFileSync } = require('child_process');
var { createSession } = require('@xeplr/cli/lib/prompt');

var OPTIONS = {
  host: 'The server (a host name, an IP, or a name from ~/.ssh/config)?',
  user: 'The SSH login (blank: as ~/.ssh/config says)?',
  'ssh-port': 'The SSH port?',
  key: 'The private key file (blank: ssh-agent or ~/.ssh/config)?',
  ref: 'Which version of Xeplr/xeplr-monitor (a branch or tag)?',
  source: '',
  ports: 'Its ports: the first of three (sign-in is +1, the API +2)?',
  'db-host': 'Postgres host (blank: keep the login set before)?',
  'db-port': 'Postgres port?',
  'db-user': 'Postgres user (one that may create databases)?',
  'redis-host': 'Redis host?',
  'redis-port': 'Redis port?',
  'admin-email': 'Super Admin email, to sign in with?',
  domain: 'Its own web address for nginx, e.g. monitor.xeplr.com (blank: leave nginx alone)?'
};
var DEFAULTS = { 'ssh-port': '22', ref: 'main', ports: '19400', 'db-port': '5432', 'db-user': 'postgres', 'redis-host': '127.0.0.1', 'redis-port': '6379' };

function parseArgs(argv) {
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    var m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error('Not an option: ' + argv[i] + ' (--help lists them)');
    if (m[1] === 'help' || m[1] === 'yes' || m[1] === 'no-certbot' || m[1] === 'update') { out[m[1]] = true; continue; }
    if (m[1] === 'certbot') { out.certbot = m[2] !== undefined ? m[2] : 'y'; continue; }
    if (OPTIONS[m[1]] === undefined) throw new Error('Unknown option --' + m[1] + ' (--help lists them)');
    out[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

// The Super Admin password is substituted into SQL by the sign-in migrations,
// so the characters that would break that are refused — @xeplr/cli's rule.
function adminPasswordProblem(v) {
  if (v.length < 8) return 'At least 8 characters.';
  if (/["'\s$#]/.test(v)) return 'No quotes, spaces, $ or # — it is substituted into SQL.';
  return null;
}

/** A value as one bash word: 'it'\''s'. */
function quote(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }

async function gather(given, session) {
  var v = Object.assign({}, given);
  var askFor = async function(k, validate) {
    if (v[k] === undefined) v[k] = await session.ask('  ' + OPTIONS[k], { default: DEFAULTS[k], validate: validate });
  };
  session.say('\n  Deploy xeplr-monitor to a server. Enter takes the value in brackets.\n');
  await askFor('host', function(x) { return x ? true : 'A server is needed.'; });
  await askFor('user');
  await askFor('ssh-port', function(x) { return /^\d+$/.test(x) ? true : 'A number.'; });
  await askFor('key', function(x) { return !x || fs.existsSync(x.replace(/^~(?=\/)/, os.homedir())) ? true : 'No file there.'; });
  if (v.key) v.key = v.key.replace(/^~(?=\/)/, os.homedir());
  if (!v.source) await askFor('ref', function(x) { return /^[A-Za-z0-9._\/-]+$/.test(x) ? true : 'A branch or tag name.'; });
  await askFor('ports', function(x) { return /^\d{4,5}$/.test(x) ? true : 'A port number.'; });

  session.say('\n  The database and Redis it uses (on the server, or reachable from it).');
  await askFor('db-host');
  if (v['db-host']) {
    await askFor('db-port', function(x) { return /^\d+$/.test(x) ? true : 'A number.'; });
    await askFor('db-user');
    v.dbPassword = process.env.XM_DB_PASSWORD !== undefined ? process.env.XM_DB_PASSWORD : await session.askSecret('  Postgres password?');
  }
  await askFor('redis-host');
  await askFor('redis-port', function(x) { return /^\d+$/.test(x) ? true : 'A number.'; });
  v.redisPassword = process.env.XM_REDIS_PASSWORD !== undefined ? process.env.XM_REDIS_PASSWORD : await session.askSecret('  Redis password (blank: none, or keep)?');

  session.say('\n  Who signs in first. More people are added in the app (Admin).');
  await askFor('admin-email', function(x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) ? true : 'That is not an email address.'; });
  v.adminPassword = process.env.XM_ADMIN_PASSWORD;
  if (v.adminPassword === undefined) {
    for (;;) {
      v.adminPassword = await session.askSecret('  Super Admin password (blank: keep the one set before)?');
      var problem = v.adminPassword ? adminPasswordProblem(v.adminPassword) : null;
      if (problem) { session.say('  ' + problem); continue; }
      if (v.adminPassword && (await session.askSecret('  Again?')) !== v.adminPassword) { session.say('  The two are not the same.'); continue; }
      break;
    }
  } else if (v.adminPassword && adminPasswordProblem(v.adminPassword)) throw new Error('XM_ADMIN_PASSWORD: ' + adminPasswordProblem(v.adminPassword));

  await askFor('domain', function(x) { return !x || /^[A-Za-z0-9.-]+$/.test(x) ? true : 'A web address like monitor.xeplr.com.'; });
  if (v.domain && v.certbot === undefined && !v['no-certbot']) v.certbot = (await session.confirm('  Get an https certificate for it with certbot now?', true)) ? 'y' : 'n';
  return v;
}

/**
 * --update: the server, and nothing else. The version is --ref (main) or
 * --source; every other value is read on the server from what the first
 * deploy wrote, and nginx is left alone.
 */
async function gatherUpdate(given, session) {
  var v = Object.assign({ 'ssh-port': DEFAULTS['ssh-port'], ref: DEFAULTS.ref }, given);
  if (v.host === undefined) v.host = await session.ask('  ' + OPTIONS.host, { validate: function(x) { return x ? true : 'A server is needed.'; } });
  if (v.key) {
    v.key = v.key.replace(/^~(?=\/)/, os.homedir());
    if (!fs.existsSync(v.key)) throw new Error('No key file at ' + v.key);
  }
  return v;
}

function summary(v) {
  var p = Number(v.ports);
  return [
    '  Server     ' + (v.user ? v.user + '@' : '') + v.host + (v['ssh-port'] !== '22' ? ':' + v['ssh-port'] : '') + (v.key ? ' (key ' + v.key + ')' : ''),
    '  Installs   ' + (v.source ? 'your checkout at ' + path.resolve(v.source) + ' (its HEAD)' : 'Xeplr/xeplr-monitor at ' + v.ref),
    '  Runs       sign-in on ' + (p + 1) + ', the API on ' + (p + 2) + ' (xeplr-monitor-auth, xeplr-monitor-api)',
    '  Postgres   ' + (v['db-host'] ? v['db-user'] + '@' + v['db-host'] + ':' + v['db-port'] + ' (password set)' : 'the login set before'),
    '  Redis      ' + v['redis-host'] + ':' + v['redis-port'],
    '  nginx      ' + (v.domain ? v.domain + (/^y/i.test(v.certbot || '') ? ', https (certbot)' : ', http only') : 'left alone'),
    '  Admin      ' + v['admin-email'] + (v.adminPassword ? ' (password set)' : ' (password kept)')
  ].join('\n');
}

function ssh(v, remote, input) {
  var args = ['-p', v['ssh-port'], '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
  if (v.key) args.push('-i', v.key);
  args.push((v.user ? v.user + '@' : '') + v.host, remote);
  return new Promise(function(resolve, reject) {
    var child = spawn('ssh', args, { stdio: ['pipe', 'inherit', 'pipe'] });
    var err = '';
    child.stderr.on('data', function(c) { err += c; process.stderr.write(c); });
    child.on('error', function(e) { reject(new Error(e.code === 'ENOENT' ? 'ssh is not installed here' : e.message)); });
    child.on('close', function(code) {
      if (!code) return resolve();
      if (/a password is required|a terminal is required/.test(err)) return reject(new Error('The SSH login needs passwordless sudo on the server'));
      if (/Permission denied|Host key verification failed|Could not resolve|Connection refused|timed out/.test(err)) return reject(new Error('Could not sign in to the server over SSH'));
      reject(new Error('The install stopped (see above)'));
    });
    if (Buffer.isBuffer(input)) child.stdin.end(input); else child.stdin.end(input || '');
  });
}

async function deploy(v) {
  if (v.update) {
    var tar = '';
    if (v.source) {
      var arch = execFileSync('git', ['-C', path.resolve(v.source), 'archive', '--format=tar.gz', 'HEAD'], { maxBuffer: 256 * 1024 * 1024 });
      tar = '/tmp/xeplr-monitor-src-' + Date.now() + '.tgz';
      await ssh(v, 'umask 077 && cat > ' + tar, arch);
    }
    var u = { XM_UPDATE: '1', XM_TARBALL: tar, XM_REF: v.ref || 'main' };
    await ssh(v, 'sudo -n bash -s', Object.keys(u).map(function(k) { return k + '=' + quote(u[k]); }).join('\n') + '\n' + fs.readFileSync(path.join(__dirname, 'install.sh'), 'utf8'));
    return;
  }
  var tarball = '';
  if (v.source) {
    // Only what is committed: the same files a push would publish.
    var archive = execFileSync('git', ['-C', path.resolve(v.source), 'archive', '--format=tar.gz', 'HEAD'], { maxBuffer: 256 * 1024 * 1024 });
    tarball = '/tmp/xeplr-monitor-src-' + Date.now() + '.tgz';
    await ssh(v, 'umask 077 && cat > ' + tarball, archive);
  }
  var values = {
    XM_TARBALL: tarball, XM_REF: v.ref || 'main', XM_PORT_BASE: v.ports,
    XM_DB_HOST: v['db-host'] || '', XM_DB_PORT: v['db-port'] || '', XM_DB_USER: v['db-user'] || '', XM_DB_PASSWORD: v.dbPassword || '',
    XM_REDIS_HOST: v['redis-host'], XM_REDIS_PORT: v['redis-port'], XM_REDIS_PASSWORD: v.redisPassword || '',
    XM_ADMIN_EMAIL: v['admin-email'], XM_ADMIN_PASSWORD: v.adminPassword || '',
    XM_DOMAIN: v.domain || '', XM_CERTBOT: v.domain && /^y/i.test(v.certbot || '') ? '1' : '0'
  };
  var script = Object.keys(values).map(function(k) { return k + '=' + quote(values[k]); }).join('\n') + '\n' +
    fs.readFileSync(path.join(__dirname, 'install.sh'), 'utf8');
  await ssh(v, 'sudo -n bash -s', script);
}

async function main() {
  var given = parseArgs(process.argv.slice(2));
  if (given.help) {
    console.log('xeplr-monitor deploy [options] — anything not given is asked; passwords are always asked (or XM_DB_PASSWORD,\nXM_REDIS_PASSWORD, XM_ADMIN_PASSWORD in the environment, for a script).\n');
    Object.keys(OPTIONS).forEach(function(k) { if (OPTIONS[k]) console.log('  --' + k.padEnd(12) + OPTIONS[k].replace(/\?$/, '') + (DEFAULTS[k] ? ' (default ' + DEFAULTS[k] + ')' : '')); });
    console.log('  --source <dir>  install a local checkout\'s HEAD instead of fetching --ref from GitHub');
    console.log('  --certbot / --no-certbot, --yes (deploy without asking to confirm)');
    console.log('  --update        only a new version: needs --host, --user, --key (and --ref or --source); asks nothing else');
    return;
  }
  var session = createSession();
  try {
    if (given.update) {
      var u = await gatherUpdate(given, session);
      session.say('\n  Updating ' + (u.user ? u.user + '@' : '') + u.host + ' to ' + (u.source ? 'your checkout at ' + path.resolve(u.source) + ' (its HEAD)' : 'Xeplr/xeplr-monitor at ' + u.ref) + '. Everything else stays as it is.\n');
      await deploy(Object.assign(u, { update: true }));
      session.say('\n  Updated.');
      return;
    }
    var v = await gather(given, session);
    session.say('\n' + summary(v) + '\n');
    if (!given.yes && !(await session.confirm('  Deploy?', false))) { session.say('  Nothing done.'); return; }
    session.say('');
    await deploy(v);
    var site = v.domain ? (/^y/i.test(v.certbot || '') ? 'https://' : 'http://') + v.domain : null;
    session.say('\n  ' + (site ? 'Open ' + site + ' and sign in as ' + v['admin-email'] + '.' : 'Point nginx at it (README: Production), or deploy again with --domain.') + ' Keep its ports closed in the firewall: nginx is the way in.');
  } finally {
    session.close();
  }
}

main().catch(function(err) { console.error('\n  ' + err.message); process.exit(1); });
