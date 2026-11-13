// THE SERVER ITSELF — memory, CPU, disks, uptime — for the Home page. Read
// from the kernel's own files (/proc, statfs), no command and no sudo, the
// same numbers `free`, `uptime` and `df` show — and what the cache holds and
// for whom (cgroup v2's memory.stat, readable without sudo too). Linux only; elsewhere every
// figure is null and `linux` is false, so the page can say so.
var fs = require('fs');
var os = require('os');

// The filesystems a person means by "disk": not proc, tmpfs, overlay and the rest.
var DISK_TYPES = ['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'jfs', 'reiserfs'];

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }

/** /proc/meminfo as bytes by key (its values are kB). */
function meminfo(text) {
  var out = {};
  String(text || '').split('\n').forEach(function(line) {
    var m = /^(\w+(?:\(\w+\))?):\s+(\d+)(?:\s+kB)?$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]) * 1024;
  });
  return out;
}

/**
 * Memory the way `free` counts it: cache is page cache plus reclaimable slab,
 * less shared memory (which `free` counts as used); used is what is left after
 * free, buffers and cache. `available` is the kernel's own estimate of what a
 * new program could have without swapping — the number that says whether the
 * server is short of memory.
 */
function memoryOf(m) {
  if (!m.MemTotal) return null;
  var cache = (m.Cached || 0) + (m.SReclaimable || 0) - (m.Shmem || 0);
  var used = m.MemTotal - (m.MemFree || 0) - (m.Buffers || 0) - cache;
  return {
    totalBytes: m.MemTotal,
    usedBytes: Math.max(0, used),
    freeBytes: m.MemFree || 0,
    availableBytes: m.MemAvailable === undefined ? null : m.MemAvailable,
    buffersBytes: m.Buffers || 0,
    cacheBytes: Math.max(0, cache),
    sharedBytes: m.Shmem || 0,
    // What the cache & buffers hold: they add up to cacheBytes + buffersBytes.
    cacheKinds: [
      { key: 'files', label: 'File contents', bytes: Math.max(0, (m.Cached || 0) - (m.Shmem || 0)) },
      { key: 'kernel', label: 'Kernel objects', bytes: m.SReclaimable || 0 },
      { key: 'buffers', label: 'Disk buffers', bytes: m.Buffers || 0 }
    ],
    swapTotalBytes: m.SwapTotal || 0,
    swapUsedBytes: Math.max(0, (m.SwapTotal || 0) - (m.SwapFree || 0))
  };
}

var CGROUP_ROOT = '/sys/fs/cgroup';
var TOP_GROUPS = 12;

/** A cgroup's memory.stat as bytes by key. */
function memoryStat(text) {
  var out = {};
  String(text || '').split('\n').forEach(function(line) {
    var f = line.trim().split(' ');
    if (f.length === 2 && /^\d+$/.test(f[1])) out[f[0]] = Number(f[1]);
  });
  return out;
}

/** What a cgroup holds in cache, counted as free counts it: file pages less shared memory, plus kernel objects it can give back. */
function cacheOfStat(st) {
  return Math.max(0, (st.file || 0) - (st.shmem || 0)) + (st.slab_reclaimable || 0);
}

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(function(d) { return d.isDirectory(); }).map(function(d) { return d.name; }); } catch (e) { return []; }
}

/**
 * WHO THE CACHE IS FOR — cgroup v2 charges each file page to the group whose
 * process first read it: each service under system.slice (postgresql.service,
 * nginx.service…), and the other top groups whole (user.slice: people signed
 * in; init.scope). Biggest first, the top TOP_GROUPS; the rest of the cache —
 * the kernel's own, or pages whose group is gone — as `others`. null without
 * cgroup v2 (no memory.stat at the root's children).
 * @returns {{ groups: Array<{ name: string, bytes: number }>, othersBytes: number }|null}
 */
function cacheByGroup(totalCache, root) {
  root = root || CGROUP_ROOT;
  var groups = [];
  subdirs(root).forEach(function(top) {
    var kids = /\.slice$/.test(top) && top !== 'user.slice' ? subdirs(root + '/' + top).filter(function(k) { return readText(root + '/' + top + '/' + k + '/memory.stat') !== null; }) : [];
    (kids.length ? kids.map(function(k) { return top + '/' + k; }) : [top]).forEach(function(path) {
      var text = readText(root + '/' + path + '/memory.stat');
      if (text === null) return;
      var bytes = cacheOfStat(memoryStat(text));
      if (bytes > 0) groups.push({ name: path.split('/').pop(), bytes: bytes });
    });
  });
  if (!groups.length) return null;
  groups.sort(function(a, b) { return b.bytes - a.bytes; });
  var top = groups.slice(0, TOP_GROUPS);
  var shown = top.reduce(function(n, g) { return n + g.bytes; }, 0);
  return { groups: top, othersBytes: Math.max(0, (totalCache || 0) - shown) };
}

// CPU use needs two readings of /proc/stat's first line: the share of the
// time between them that was not idle.
var lastCpu = null;
function cpuUse(text, at) {
  var m = /^cpu\s+(.+)$/m.exec(String(text || ''));
  if (!m) return null;
  var f = m[1].trim().split(/\s+/).map(Number);
  var idle = f[3] + (f[4] || 0);                 // idle + iowait
  var total = f.reduce(function(a, b) { return a + b; }, 0);
  var prev = lastCpu;
  if (prev && at - prev.at < 1000) return prev.percent;
  var percent = prev && total > prev.total ? Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10 : null;
  lastCpu = { idle: idle, total: total, at: at, percent: percent };
  return percent;
}

/** Each real disk once (by device), with its size, what is used and what is left. */
function disks(mountsText) {
  var seen = new Set();
  var out = [];
  String(mountsText || '').split('\n').forEach(function(line) {
    var f = line.split(' ');
    if (f.length < 3 || DISK_TYPES.indexOf(f[2]) < 0) return;
    var device = f[0];
    var mount = f[1].replace(/\\040/g, ' ');
    if (seen.has(device)) return;
    // A single file mounted from a disk (a container's /etc/resolv.conf) is
    // not a disk of its own: a disk is mounted on a folder.
    try { if (!fs.statSync(mount).isDirectory()) return; } catch (e) { return; }
    seen.add(device);
    var s;
    try { s = fs.statfsSync(mount); } catch (e) { return; }
    var total = s.blocks * s.bsize;
    if (!total) return;
    var free = s.bfree * s.bsize;
    out.push({ device: device, mount: mount, type: f[2], totalBytes: total, usedBytes: total - free, availableBytes: s.bavail * s.bsize });
  });
  return out.sort(function(a, b) { return a.mount.localeCompare(b.mount); });
}

function osName() {
  var m = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(readText('/etc/os-release') || '');
  return m ? m[1] : os.type();
}

function withCacheByGroup(m) {
  if (m) m.cacheBy = cacheByGroup(m.cacheBytes + m.buffersBytes);
  return m;
}

/** Everything the Home page shows, now. */
function stats() {
  var linux = process.platform === 'linux' && readText('/proc/meminfo') !== null;
  var uptime = linux ? Number(String(readText('/proc/uptime') || '').split(' ')[0]) : null;
  var cpus = os.cpus();
  return {
    linux: linux,
    at: new Date().toISOString(),
    host: {
      name: os.hostname(),
      os: linux ? osName() : os.type(),
      kernel: os.release(),
      arch: os.arch(),
      uptimeSeconds: uptime === null || isNaN(uptime) ? null : Math.round(uptime)
    },
    memory: linux ? withCacheByGroup(memoryOf(meminfo(readText('/proc/meminfo')))) : null,
    cpu: {
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model.trim() : null,
      load: linux ? os.loadavg().map(function(x) { return Math.round(x * 100) / 100; }) : null,
      usePercent: linux ? cpuUse(readText('/proc/stat'), Date.now()) : null
    },
    disks: linux ? disks(readText('/proc/mounts')) : []
  };
}

module.exports = { stats: stats, meminfo: meminfo, memoryOf: memoryOf, memoryStat: memoryStat, cacheByGroup: cacheByGroup, disks: disks, cpuUse: cpuUse, DISK_TYPES: DISK_TYPES };
