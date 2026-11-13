-- 0002_backup_connections.sql — the logins the backup jobs use.
--
-- A database connection is a SERVER login (host, port, user): the job picks
-- which database on it to back up. An S3 one is a bucket, its region and the
-- folder backups go in. What is not secret is in "details" (shown on the
-- page); the password or secret key is in "secret", encrypted with
-- ENCRYPTION_KEY (@xeplr/utils), never sent back to a browser and never in a
-- job: a job holds this row's id, and the login is filled in only for the run.
CREATE TABLE IF NOT EXISTS "backup_connections" (
  "id"         varchar(25) PRIMARY KEY,
  "name"       varchar(80) NOT NULL,
  "kind"       varchar(20) NOT NULL,      -- postgres | mysql | s3
  "details"    jsonb NOT NULL,            -- { host, port, user } | { bucket, region, prefix, accessKeyHint }
  "secret"     text NOT NULL,             -- encrypted JSON: { password } | { accessKeyId, secretAccessKey }
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
CREATE UNIQUE INDEX IF NOT EXISTS "backup_connections_name" ON "backup_connections" (lower("name")) WHERE "isActive";
