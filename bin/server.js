#!/usr/bin/env node
// The monitor on its own: `xeplr-monitor-server`, run by its systemd service
// (deploy/xeplr-monitor.service). Settings come from the environment; a
// missing required one stops it here, naming it.
var monitor = require('../index');

var missing = monitor.requiredEnv.filter(function(k) { return !process.env[k]; });
if (missing.length) {
  console.error('[xeplr-monitor] not started. Set ' + missing.join(', ') + ' (see the README)');
  process.exit(1);
}

monitor.start({
  dataDir: process.env.MONITOR_DATA_DIR,
  secret: process.env.MONITOR_SECRET,
  allow: process.env.MONITOR_ALLOW,
  sudo: process.env.MONITOR_SUDO,
  port: process.env.MONITOR_PORT,
  host: process.env.MONITOR_HOST
}).catch(function(err) {
  console.error('[xeplr-monitor] could not start:', err.message);
  process.exit(1);
});
