-- 0007_monitor_home.sql — the Home page: the server itself (memory, CPU,
-- disks, uptime), and its one route.
--
-- The menu name is the KEY: it must match ui/src/App.jsx's drawerItems `key`
-- EXACTLY ('Home'). The apis name must match routes/monitor.js's API map.
-- Granted with monitor:view: everyone who may see the services may see the
-- server they run on. Inserts are insert-if-absent, safe to run again.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Home', 'monitor:view', false, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Home');
-- A database first made by @xeplr/cli has a public 'Home' row of its own; it is
-- this page now.
UPDATE "menus" SET "menuGroup" = 'monitor:view', "isPublic" = false WHERE name = 'Home';

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), name, "group", false, true, '*', now(), now()
FROM (VALUES
  ('View server statistics', 'monitor:view')
) AS v(name, "group")
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a."apiGroup" = v."group" AND a.name = v.name);

WITH grants(role, "group") AS (VALUES
  ('Super Admin', 'monitor:view'),
  ('CompanyAdmin', 'monitor:view'),
  ('Admin', 'monitor:view'),
  ('Editor', 'monitor:view'),
  ('Creator', 'monitor:view'),
  ('Viewer', 'monitor:view')
)
INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM grants g
JOIN "roles" r ON r.name = g.role
JOIN "apis" a ON a."apiGroup" = g."group" AND a.name = 'View server statistics'
WHERE NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "menuRolesMapping" (id, "menuId", "roleId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), m.id, r.id, true, '*', now(), now()
FROM "roles" r JOIN "menus" m ON m.name = 'Home'
WHERE r.name IN ('Super Admin', 'CompanyAdmin', 'Admin', 'Editor', 'Creator', 'Viewer')
  AND NOT EXISTS (SELECT 1 FROM "menuRolesMapping" x WHERE x."roleId" = r.id AND x."menuId" = m.id);
