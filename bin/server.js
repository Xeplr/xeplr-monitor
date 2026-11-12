#!/usr/bin/env node
// The monitor on its own: `xeplr-monitor-server`, run by its systemd service
// (deploy/xeplr-monitor.service). Settings come from the environment; a
// missing required one stops it here, naming it.
var { checkEnv } = require('@xeplr/base-apis');
var monitor = require('../index');

checkEnv(monitor.requiredEnv, { appName: 'xeplr-monitor' }); // names each missing one and exits

monitor.start({
  dataDir: process.env.MONITOR_DATA_DIR,
  secret: process.env.MONITOR_SECRET,
  allow: process.env.MONITOR_ALLOW,
  sudo: process.env.MONITOR_SUDO,
  port: process.env.MONITOR_PORT
}).catch(function(err) {
  console.error('[xeplr-monitor] could not start:', err.message);
  process.exit(1);
});
