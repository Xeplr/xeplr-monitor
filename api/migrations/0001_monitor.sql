-- 0001_monitor.sql — the monitor's own tables.
--
-- monitor_services: the systemd services someone chose to watch. A service is
-- controlled only once it is here AND its unit matches MONITOR_ALLOW; sudoers
-- repeats that pattern.
CREATE TABLE IF NOT EXISTS "monitor_services" (
  "id"         varchar(25) PRIMARY KEY,
  "unit"       varchar(200) NOT NULL,     -- xeplr-bi-api.service
  "label"      varchar(80) NOT NULL,      -- what people read; changed any time
  "addedBy"    varchar(200),
  "isActive"   boolean DEFAULT true,
  "mtId1"      varchar(25),
  "mtId2"      varchar(25),
  "mtId3"      varchar(25),
  "mtId4"      varchar(25),
  "recordCreatedDate"  timestamp DEFAULT now(),
  "recordModifiedDate" timestamp DEFAULT now(),
  "recordCreatedBy"    varchar(25),
  "recordModifiedBy"   varchar(25)
);
CREATE UNIQUE INDEX IF NOT EXISTS "monitor_services_unit" ON "monitor_services" ("unit") WHERE "isActive";

-- monitor_audit: every change made through the monitor, refused ones too —
-- who, from where, what, on which service, and whether it worked.
CREATE TABLE IF NOT EXISTS "monitor_audit" (
  "id"         varchar(25) PRIMARY KEY,
  "email"      varchar(200),
  "ip"         varchar(64),
  "action"     varchar(40) NOT NULL,      -- add | edit | remove | start | stop | restart | kill
  "unit"       varchar(200),
  "ok"         boolean NOT NULL,
  "error"      text,
  "isActive"   boolean DEFAULT true,
  "mtId1"      varchar(25),
  "mtId2"      varchar(25),
  "mtId3"      varchar(25),
  "mtId4"      varchar(25),
  "recordCreatedDate"  timestamp DEFAULT now(),
  "recordModifiedDate" timestamp DEFAULT now(),
  "recordCreatedBy"    varchar(25),
  "recordModifiedBy"   varchar(25)
);
CREATE INDEX IF NOT EXISTS "monitor_audit_when" ON "monitor_audit" ("recordCreatedDate" DESC);
