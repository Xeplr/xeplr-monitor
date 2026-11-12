// One call: decrypt the connection, connect to this app's own database, and
// wire the models to it. Exports the connection promise, awaited by callers
// that need it ready.
var { getConnection } = require('@xeplr/db');

// No `|| 'xeplr_monitor_api'` fallback. DB_API is required at startup
// (env.required.js), so a default could only ever fire in a process that
// skipped that check — and silently connecting to a database nobody named is
// exactly what the check exists to prevent.
module.exports = getConnection(process.env.DB_API, process.env.XEPLR_MONITOR_CONNECTION);
