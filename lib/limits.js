// SIGN-IN ATTEMPTS — after FAILS wrong tries for one email within WINDOW,
// that email is refused for LOCK; after FAILS_PER_ADDRESS from one address
// (any emails), that address is. The address gets more room: several people
// behind one office network share it. Kept in memory: a restart clears it,
// which only ever helps the person who restarted it.
var FAILS = 5;
var FAILS_PER_ADDRESS = 20;
var WINDOW_MS = 15 * 60 * 1000;
var LOCK_MS = 15 * 60 * 1000;

var seen = new Map(); // key -> { fails: [times], lockedUntil }

function entry(key) {
  var e = seen.get(key);
  if (!e) { e = { fails: [], lockedUntil: 0 }; seen.set(key, e); }
  return e;
}

/** Minutes left on a lock for any of the keys, or 0. */
function lockedFor(keys, now) {
  now = now || Date.now();
  var until = keys.reduce(function(m, k) { var e = seen.get(k); return e && e.lockedUntil > m ? e.lockedUntil : m; }, 0);
  return until > now ? Math.ceil((until - now) / 60000) : 0;
}

function failed(keys, now) {
  now = now || Date.now();
  keys.forEach(function(k) {
    var e = entry(k);
    e.fails = e.fails.filter(function(t) { return now - t < WINDOW_MS; }).concat([now]);
    if (e.fails.length >= (k.indexOf('ip:') === 0 ? FAILS_PER_ADDRESS : FAILS)) { e.lockedUntil = now + LOCK_MS; e.fails = []; }
  });
}

function succeeded(keys) { keys.forEach(function(k) { seen.delete(k); }); }

// Old entries swept now and then, so the map does not grow with every address that ever tried.
var sweep = setInterval(function() {
  var now = Date.now();
  seen.forEach(function(e, k) { if (e.lockedUntil < now && !e.fails.some(function(t) { return now - t < WINDOW_MS; })) seen.delete(k); });
}, WINDOW_MS);
if (sweep.unref) sweep.unref();

module.exports = { lockedFor: lockedFor, failed: failed, succeeded: succeeded, FAILS: FAILS, FAILS_PER_ADDRESS: FAILS_PER_ADDRESS };
