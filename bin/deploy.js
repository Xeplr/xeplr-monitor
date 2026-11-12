#!/usr/bin/env node
// DEPLOY THE MONITOR TO A SERVER, FROM YOUR LAPTOP — over SSH, asking for
// what it needs as it goes. Nothing is stored: not in the repository, not on
// your laptop. The sign-in secret is made on the server; your password is
// typed (hidden) and goes only to the server, on SSH's input.
//
//   npx -p @xeplr/monitor xeplr-monitor-deploy
//   npx -p @xeplr/monitor xeplr-monitor-deploy --host testbi.xeplr.com --user ubuntu --key ~/.ssh/testbi.pem
//
// Anything not given as an argument is asked. The password is always asked
// (or read from MONITOR_NEW_PASSWORD, for a script), never an argument: it
// would sit in the shell's history and in `ps`.
//
// What runs on the server is deploy/install.sh, as root through `sudo -n`, so
// the SSH login needs passwordless sudo (as BI's deploy login has). Running it
// again updates in place.
var fs = require('fs');
var os = require('os');
var path = require('path');
var readline = require('readline');
var { spawn } = require('child_process');
var users = require('../lib/users');
var pkg = require('../package.json');

var OPTIONS = {
  host: 'The server (a host name, an IP, or a name from ~/.ssh/config)',
  user: 'The SSH login (blank: as ~/.ssh/config or your own name says)',
  'ssh-port': 'The SSH port',
  key: 'The private key file (blank: ssh-agent or ~/.ssh/config)',
  allow: 'The services it may control, comma-separated (* matches anything)',
  port: 'Its port on the server (nginx forwards to it)',
  domain: 'Its own web address for nginx, e.g. monitor.xeplr.com (blank: leave nginx alone)',
  certbot: 'Get an https certificate for it with certbot now? (y/n)',
  email: 'Your email, to sign in with',
  name: 'Your name (optional)',
  version: 'The @xeplr/monitor version to install'
};
var DEFAULTS = { 'ssh-port': '22', allow: 'xeplr-*', port: '19400', certbot: 'y', version: pkg.version };

function parseArgs(argv) {
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    var m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error('Not an option: ' + argv[i] + '. Options: ' + Object.keys(OPTIONS).map(function(k) { return '--' + k; }).join(' '));
    if (m[1] === 'help') { out.help = true; continue; }
    if (m[1] === 'yes') { out.yes = true; continue; }
    if (!OPTIONS[m[1]]) throw new Error('Unknown option --' + m[1]);
    out[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

// Answers are read as lines into a queue, so a line typed (or pasted, or
// piped) before its question is asked is kept for it, not dropped. While a
// password is asked, what is typed is not echoed.
var rl = null;
var lines = [];
var waiting = null;
var ended = false;
var hidden = false;
function lineReader() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  var write = rl._writeToOutput;
  rl._writeToOutput = function(s) { if (!hidden) write.call(rl, s); };
  rl.on('line', function(l) { if (waiting) { var w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.on('close', function() { ended = true; if (waiting) { var w = waiting; waiting = null; w(''); } });
  return rl;
}
function nextLine(prompt) {
  lineReader();
  process.stdout.write(prompt);
  if (lines.length) { var l = lines.shift(); if (!process.stdin.isTTY) process.stdout.write('\n'); return Promise.resolve(l); }
  if (ended) { process.stdout.write('\n'); return Promise.resolve(''); }
  return new Promise(function(resolve) { waiting = function(l) { if (!process.stdin.isTTY) process.stdout.write('\n'); resolve(l); }; });
}
function ask(question, fallback) {
  return nextLine('  ' + question + (fallback ? ' [' + fallback + ']' : '') + ': ').then(function(a) { return a.trim() || fallback || ''; });
}
function askHidden(question) {
  if (process.env.MONITOR_NEW_PASSWORD !== undefined) return Promise.resolve(process.env.MONITOR_NEW_PASSWORD);
  hidden = true;
  return nextLine('  ' + question + ': ').then(function(a) {
    hidden = false;
    if (process.stdin.isTTY) process.stdout.write('\n');
    return a;
  });
}

/** A value as one bash word: 'it'\''s'. */
function quote(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }

async function gather(given) {
  var v = Object.assign({}, given);
  console.log('\n  Deploy the Xeplr Monitor to a server. Press Enter to take the value in brackets.\n');
  for (var k of ['host', 'user', 'ssh-port', 'key', 'allow', 'port', 'domain']) {
    if (v[k] === undefined) v[k] = await ask(OPTIONS[k], DEFAULTS[k]);
  }
  if (!v.host) throw new Error('A server is needed');
  if (v.key) {
    v.key = v.key.replace(/^~(?=\/)/, os.homedir());
    if (!fs.existsSync(v.key)) throw new Error('No key file at ' + v.key);
  }
  if (!/^\d+$/.test(v.port) || !/^\d+$/.test(v['ssh-port'])) throw new Error('Ports are numbers');
  if (!/^[A-Za-z0-9@._:*,\s-]+$/.test(v.allow)) throw new Error('The services to control are names and * only, comma-separated: ' + v.allow);
  if (v.domain && !/^[A-Za-z0-9.-]+$/.test(v.domain)) throw new Error('Not a web address: ' + v.domain);
  if (v.domain && v.certbot === undefined) v.certbot = await ask(OPTIONS.certbot, DEFAULTS.certbot);
  if (v.email === undefined) v.email = await ask(OPTIONS.email);
  if (!/^[^\s@]+@[^\s@]+$/.test(v.email || '')) throw new Error('An email is needed, to sign in with');
  if (v.name === undefined) v.name = await ask(OPTIONS.name);
  if (v.version === undefined) v.version = DEFAULTS.version;
  v.password = await askHidden('Password, at least ' + users.MIN_PASSWORD + ' characters (blank: keep it, if you are already a user)');
  if (v.password) {
    if (v.password.length < users.MIN_PASSWORD) throw new Error('The password must be at least ' + users.MIN_PASSWORD + ' characters');
    if (process.env.MONITOR_NEW_PASSWORD === undefined && (await askHidden('Again')) !== v.password) throw new Error('The two passwords are not the same');
  }
  return v;
}

function summary(v) {
  return [
    '  Server     ' + (v.user ? v.user + '@' : '') + v.host + (v['ssh-port'] !== '22' ? ':' + v['ssh-port'] : '') + (v.key ? ' (key ' + v.key + ')' : ''),
    '  Installs   @xeplr/monitor@' + v.version + ', port ' + v.port,
    '  Controls   ' + v.allow,
    '  nginx      ' + (v.domain ? v.domain + (/^y/i.test(v.certbot) ? ', with an https certificate (certbot)' : ', http only') : 'left alone'),
    '  User       ' + v.email + (v.password ? ' (password set)' : ' (password kept)')
  ].join('\n');
}

function deploy(v) {
  var script = [
    'XM_VERSION=' + quote(v.version),
    'XM_ALLOW=' + quote(v.allow),
    'XM_PORT=' + quote(v.port),
    'XM_EMAIL=' + quote(v.email),
    'XM_NAME=' + quote(v.name || ''),
    'XM_PASSWORD=' + quote(v.password || ''),
    'XM_DOMAIN=' + quote(v.domain || ''),
    'XM_CERTBOT=' + quote(v.domain && /^y/i.test(v.certbot) ? '1' : '0'),
    fs.readFileSync(path.join(__dirname, '..', 'deploy', 'install.sh'), 'utf8')
  ].join('\n');
  var args = ['-p', v['ssh-port'], '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
  if (v.key) args.push('-i', v.key);
  args.push((v.user ? v.user + '@' : '') + v.host, 'sudo -n bash -s');
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
    child.stdin.end(script);
  });
}

async function main() {
  var given = parseArgs(process.argv.slice(2));
  if (given.help) {
    console.log('xeplr-monitor-deploy [options]: anything not given is asked; the password is always asked.\n');
    Object.keys(OPTIONS).forEach(function(k) { console.log('  --' + k.padEnd(10) + OPTIONS[k] + (DEFAULTS[k] ? ' (default ' + DEFAULTS[k] + ')' : '')); });
    console.log('  --yes       deploy without asking to confirm');
    return;
  }
  var v = await gather(given);
  console.log('\n' + summary(v) + '\n');
  if (!given.yes && !/^y/i.test(await ask('Deploy? (y/n)', 'n'))) { console.log('  Nothing done.'); return; }
  console.log('');
  await deploy(v);
  if (v.domain) console.log('\n  Open ' + (/^y/i.test(v.certbot) ? 'https://' : 'http://') + v.domain + ' and sign in. Keep port ' + v.port + ' closed in the firewall: nginx is the way in.');
  else console.log('\n  Point nginx at port ' + v.port + ' (deploy/nginx.conf.example), or deploy again with --domain.');
}

main().then(function() { if (rl) rl.close(); }).catch(function(err) {
  if (rl) rl.close();
  console.error('\n  ' + err.message);
  process.exit(1);
});
