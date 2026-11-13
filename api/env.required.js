/**
 * Mandatory env vars for the xeplr-monitor API process. Checked at startup
 * (bin/www) and at build (`npm run check-env`).
 *
 * SPREAD EACH LIBRARY'S OWN LIST rather than re-typing its variable names.
 * The names belong to the library, so a new requirement it adds lands here on
 * the next upgrade with nothing to remember — and nothing drifts out of step.
 * Only APP-SPECIFIC names are written out literally below.
 */
module.exports = [
  // ENCRYPTION_KEY, AUTH_JWT_SECRET, AUTH_PORT, AUTH_DB_NAME,
  // XEPLR_AUTH_MIGRATIONS, AUTH_SUPER_ADMIN_EMAIL / _PASSWORD, REDIS_PREFIX,
  // AUTH_TENANT_HEADER, and the sign-up settings: AUTH_REGISTER_ROLES,
  // AUTH_ACTIVATION_URL, AUTH_RESET_URL
  ...require('@xeplr/auth').requiredEnv,

  // ── this app's own ──
  'XEPLR_MONITOR_PORT',

  // Where the sign-in service is. createApp gates every route by default and
  // validates against this, so a missing one already stops the boot with a
  // named variable — listing it here just moves the same complaint to
  // `npm run check-env`, before anything starts at all.
  'AUTH_URL',

  // This app's own database. NEVER defaulted: a wrong-but-present name boots
  // clean, migrates, serves traffic and reads as EMPTY DATA rather than as an
  // error — the most expensive way for this to go wrong.
  'DB_API',

  'XEPLR_MONITOR_CONNECTION',

  // The backup jobs' own database (DB_JOBS), and where a dump is written
  // before it goes to S3 (XEPLR_DATA_DIR, absolute) — lib/backups.js.
  ...require('@xeplr/jobs').requiredEnv,
  ...require('@xeplr/actions').requiredEnv,
];
