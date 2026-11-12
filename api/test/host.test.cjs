// The server itself, for the Home page: memory counted the way `free` counts
// it, CPU use from two readings, the real disks once each. On Linux, checked
// against `free -b` and `df` on the same machine.
var test = require('node:test');
var assert = require('node:assert');
var { execFileSync } = require('child_process');
var host = require('../lib/host');

var SAMPLE = [
  'MemTotal:        8000000 kB', 'MemFree:         1000000 kB', 'MemAvailable:    5000000 kB',
  'Buffers:          200000 kB', 'Cached:          3000000 kB', 'SwapCached:            0 kB',
  'Shmem:            100000 kB', 'SReclaimable:     300000 kB', 'SwapTotal:       2000000 kB', 'SwapFree:        1500000 kB'
].join('\n');

test('memory, the way free counts it', function() {
  var m = host.memoryOf(host.meminfo(SAMPLE));
  var kb = 1024;
  assert.equal(m.totalBytes, 8000000 * kb);
  assert.equal(m.cacheBytes, (3000000 + 300000 - 100000) * kb, 'cache: page cache + reclaimable slab - shared');
  assert.equal(m.usedBytes, (8000000 - 1000000 - 200000 - 3200000) * kb, 'used: what free, buffers and cache leave');
  assert.equal(m.availableBytes, 5000000 * kb);
  assert.equal(m.swapUsedBytes, 500000 * kb);
  assert.equal(host.memoryOf({}), null, 'no meminfo, no memory');
});

test('CPU use: the busy share between two readings', function() {
  assert.equal(host.cpuUse('cpu  100 0 100 800 0 0 0 0 0 0', 10000), null, 'one reading says nothing yet');
  // 1000 more ticks, 250 of them idle: 75% busy.
  assert.equal(host.cpuUse('cpu  500 0 450 1050 0 0 0 0 0 0', 12000), 75);
});

var linux = process.platform === 'linux';
test('on this server: the same numbers as free and df', { skip: linux ? false : 'not Linux' }, function() {
  var s = host.stats();
  assert.equal(s.linux, true);
  var free = execFileSync('free', ['-b']).toString().split('\n').find(function(l) { return /^Mem:/.test(l); }).trim().split(/\s+/).map(Number);
  // free -b: Mem: total used free shared buff/cache available
  assert.equal(s.memory.totalBytes, free[1], 'total');
  var near = function(a, b, what) { assert.ok(Math.abs(a - b) <= 64 * 1024 * 1024, what + ': ' + a + ' vs free\'s ' + b); };
  near(s.memory.availableBytes, free[6], 'available');
  near(s.memory.freeBytes, free[3], 'free');
  near(s.memory.buffersBytes + s.memory.cacheBytes, free[5], 'buff/cache');
  assert.ok(s.cpu.cores >= 1 && s.cpu.load.length === 3);
  assert.ok(s.host.uptimeSeconds > 0 && s.host.os && s.host.kernel);
  s.disks.forEach(function(d) { assert.ok(require('fs').statSync(d.mount).isDirectory(), d.mount + ' is a folder, not a file mounted from a disk'); });
  var root = s.disks.find(function(d) { return d.mount === '/'; });
  if (root) {
    var df = execFileSync('df', ['-B1', '--output=size', '/']).toString().trim().split('\n')[1].trim();
    assert.equal(root.totalBytes, Number(df), 'the root disk\'s size, as df says');
  }
});
