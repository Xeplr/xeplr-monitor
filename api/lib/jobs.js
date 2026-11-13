// THE BACKUP JOBS — @xeplr/jobs, in their own database (DB_JOBS), run by this
// API, with @xeplr/backups' two actions: backup-database (databases on a
// saved server → S3) and backup-folder (folders of THIS APP'S OWN data folder
// → S3). Each job is set on the Jobs page (@xeplr/ui-jobs), on its schedule.
//
// A job holds the connections' ids; @xeplr/backups' resolveConnection fills
// in the logins only for the run, so no password is in a job or its history.
var path = require('path');
var jobs = require('@xeplr/jobs');
var backups = require('@xeplr/backups');

/** The jobs database: made if missing, then jobs' own migrations; and backups' table in this app's own. */
async function migrate() {
  var db = require('@xeplr/db');
  var resolved = await db.resolveConfig('api');
  await db.ensureDatabaseFor(resolved, process.env.DB_JOBS);
  var result = await db.migrator.up({
    db: process.env.DB_JOBS,
    dir: path.join(path.dirname(require.resolve('@xeplr/jobs')), 'migrations'),
    connectionName: 'api'
  });
  if (result.migrations.length) console.log('[jobs] ran migrations: ' + result.migrations.join(', '));
  // backup_connections — IF NOT EXISTS: this app made it itself before
  // (migrations/0002), and keeps its rows.
  var own = await db.sqlMigrator.up({ db: process.env.DB_API, dir: backups.migrationsDir, connectionName: 'api' });
  if (own.migrations.length) console.log('[backups] ran migrations: ' + own.migrations.join(', '));
}

/** Migrate, start @xeplr/jobs with only the backup actions, start the scheduler. */
async function start() {
  await migrate();
  await jobs.init({
    database: process.env.DB_JOBS,
    connection: process.env.XEPLR_MONITOR_CONNECTION,
    defaultActions: false,
    resolveConnection: backups.resolveConnection
  });
  var names = backups.register(jobs);
  jobs.startScheduler({ intervalMs: 10000 });
  console.log('[jobs] scheduler started: ' + names.join(', '));
}

module.exports = { start: start };
