-- 0008_backups.sql — database backups: the Backup connections page and its
-- routes (routes/connections.js). The jobs themselves are @xeplr/jobs', with
-- its own rows (node_modules/@xeplr/jobs/migrations-auth, also run: see
-- XEPLR_AUTH_MIGRATIONS).
--
-- The menu name is the KEY: it must match ui/src/App.jsx's drawerItems `key`
-- EXACTLY ('Backup connections'). The apis names must match
-- routes/connections.js's API map. Only admins: these are the logins to every
-- database on the server. Inserts are insert-if-absent, safe to run again.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Backup connections', 'backups:view', false, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Backup connections');

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), name, "group", false, true, '*', now(), now()
FROM (VALUES
  ('List backup connections', 'backups:view'),
  ('Test a backup connection', 'backups:view'),
  ('Save a backup connection', 'backups:manage'),
  ('Remove a backup connection', 'backups:manage')
) AS v(name, "group")
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a."apiGroup" = v."group" AND a.name = v.name);

WITH grants(role, "group") AS (VALUES
  ('Super Admin', 'backups:view'),
  ('CompanyAdmin', 'backups:view'),
  ('Admin', 'backups:view'),
  ('Super Admin', 'backups:manage'),
  ('CompanyAdmin', 'backups:manage'),
  ('Admin', 'backups:manage')
)
INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM grants g
JOIN "roles" r ON r.name = g.role
JOIN "apis" a ON a."apiGroup" = g."group"
WHERE NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "menuRolesMapping" (id, "menuId", "roleId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), m.id, r.id, true, '*', now(), now()
FROM "roles" r JOIN "menus" m ON m.name = 'Backup connections'
WHERE r.name IN ('Super Admin', 'CompanyAdmin', 'Admin')
  AND NOT EXISTS (SELECT 1 FROM "menuRolesMapping" x WHERE x."roleId" = r.id AND x."menuId" = m.id);
