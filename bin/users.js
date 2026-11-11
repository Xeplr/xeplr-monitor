#!/usr/bin/env node
// WHO CAN SIGN IN — managed on the server only, never from the page.
//
//   xeplr-monitor-users list
//   xeplr-monitor-users add <email> [--name "Full name"] [--no-code]
//   xeplr-monitor-users password <email>
//   xeplr-monitor-users code <email> [--off]       a new authenticator secret (or none)
//   xeplr-monitor-users remove <email>
//
// Reads MONITOR_DATA_DIR. A password is typed, never passed as an argument
// (it would sit in the shell's history and in `ps`); MONITOR_NEW_PASSWORD is
// read instead when set, for a script.
var readline = require('readline');
var store = require('../lib/store');
var users = require('../lib/users');

var args = process.argv.slice(2);
var cmd = args[0];
var email = args[1];
function flag(name) { return args.indexOf(name) > -1; }
function option(name) { var i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; }

function ask(question) {
  if (process.env.MONITOR_NEW_PASSWORD) return Promise.resolve(process.env.MONITOR_NEW_PASSWORD);
  return new Promise(function(resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function(s) { if (!rl.stdoutMuted || /\n/.test(s)) rl.output.write(s.replace(/[^\n]/g, '')); };
    process.stdout.write(question);
    rl.question('', function(answer) { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function newPassword() {
  var p = await ask('Password (at least ' + users.MIN_PASSWORD + ' characters): ');
  if (!process.env.MONITOR_NEW_PASSWORD) {
    var again = await ask('Again: ');
    if (again !== p) throw new Error('The two passwords are not the same');
  }
  return p;
}

function showCode(out) {
  if (!out.secret) return console.log('No code asked for when signing in.');
  console.log('\nAdd this to an authenticator app (Google Authenticator, 1Password, Authy):');
  console.log('  secret: ' + out.secret);
  console.log('  or open: ' + out.url + '\n');
}

async function main() {
  store.open(process.env.MONITOR_DATA_DIR);
  if (cmd === 'list') {
    var list = users.list();
    if (!list.length) return console.log('No users yet. Add one: xeplr-monitor-users add <email>');
    list.forEach(function(u) { console.log(u.email + (u.name !== u.email ? ' (' + u.name + ')' : '') + (u.twoStep ? '  · code asked' : '  · password only')); });
    return;
  }
  if (!email || ['add', 'password', 'code', 'remove'].indexOf(cmd) < 0) {
    console.log('xeplr-monitor-users list | add <email> [--name "…"] [--no-code] | password <email> | code <email> [--off] | remove <email>');
    process.exitCode = 1;
    return;
  }
  if (cmd === 'add') {
    var out = users.add(email, await newPassword(), { name: option('--name'), twoStep: !flag('--no-code') });
    store.audit({ email: out.user.email, action: 'user-added', ok: true, by: 'server' });
    console.log('Added ' + out.user.email + '.');
    return showCode(out);
  }
  if (cmd === 'password') {
    users.setPassword(email, await newPassword());
    store.audit({ email: email, action: 'password-changed', ok: true, by: 'server' });
    return console.log('Changed. Every session ' + email + ' had open is signed out.');
  }
  if (cmd === 'code') {
    var c = users.setTwoStep(email, !flag('--off'));
    store.audit({ email: email, action: flag('--off') ? 'code-off' : 'code-new', ok: true, by: 'server' });
    return showCode(c);
  }
  if (cmd === 'remove') {
    users.remove(email);
    store.audit({ email: email, action: 'user-removed', ok: true, by: 'server' });
    return console.log('Removed ' + email + '.');
  }
}

main().catch(function(err) { console.error(err.message); process.exit(1); });
