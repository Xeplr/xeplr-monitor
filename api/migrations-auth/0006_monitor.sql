-- 0006_monitor.sql — the Monitor page, its routes, and who may use them.
--
-- The menu name is the KEY: it must match ui/src/App.jsx's drawerItems `key`
-- EXACTLY ('Monitor'). @xeplr/ui-account drops unrecognised names silently.
--
-- The apis names must match routes/monitor.js's API map EXACTLY: each route
-- checks its own name with requireApi.
--
-- Groups, and the roles they go to:
--   monitor:view     see the services, their processes and logs   Super Admin, CompanyAdmin, Admin, Editor, Creator, Viewer
--   monitor:control  start, stop, restart, kill                     Super Admin, CompanyAdmin, Admin, Editor
--   monitor:manage   add, edit, remove watched services             Super Admin, CompanyAdmin, Admin
--   monitor:audit    read the audit log                             Super Admin, CompanyAdmin, Admin
-- Changed later in Admin → roles; these are the starting grants.
-- Inserts are insert-if-absent, safe to run again.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Monitor', 'monitor:view', false, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Monitor');

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), name, "group", false, true, '*', now(), now()
FROM (VALUES
  ('View monitor settings', 'monitor:view'),
  ('List monitored services', 'monitor:view'),
  ('Read service logs', 'monitor:view'),
  ('Follow service logs live', 'monitor:view'),
  ('Start, stop, restart or kill a service', 'monitor:control'),
  ('Add a monitored service', 'monitor:manage'),
  ('Edit a monitored service', 'monitor:manage'),
  ('Remove a monitored service', 'monitor:manage'),
  ('Read the monitor audit log', 'monitor:audit')
) AS v(name, "group")
WHERE NOT EXISTS (SELECT 1 FROM "apis" a WHERE a."apiGroup" = v."group" AND a.name = v.name);

-- Each role → the monitor groups it gets: its apis, and the Monitor menu.
WITH grants(role, "group") AS (VALUES
  ('Super Admin', 'monitor:view'), ('Super Admin', 'monitor:control'), ('Super Admin', 'monitor:manage'), ('Super Admin', 'monitor:audit'),
  ('CompanyAdmin', 'monitor:view'), ('CompanyAdmin', 'monitor:control'), ('CompanyAdmin', 'monitor:manage'), ('CompanyAdmin', 'monitor:audit'),
  ('Admin', 'monitor:view'), ('Admin', 'monitor:control'), ('Admin', 'monitor:manage'), ('Admin', 'monitor:audit'),
  ('Editor', 'monitor:view'), ('Editor', 'monitor:control'),
  ('Creator', 'monitor:view'),
  ('Viewer', 'monitor:view')
)
INSERT INTO "apisRolesMapping" (id, "roleId", "apiId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, a.id, true, '*', now(), now()
FROM grants g
JOIN "roles" r ON r.name = g.role
JOIN "apis" a ON a."apiGroup" = g."group"
WHERE NOT EXISTS (SELECT 1 FROM "apisRolesMapping" m WHERE m."roleId" = r.id AND m."apiId" = a.id);

INSERT INTO "menuRolesMapping" (id, "menuId", "roleId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), m.id, r.id, true, '*', now(), now()
FROM "roles" r JOIN "menus" m ON m.name = 'Monitor'
WHERE r.name IN ('Super Admin', 'CompanyAdmin', 'Admin', 'Editor', 'Creator', 'Viewer')
  AND NOT EXISTS (SELECT 1 FROM "menuRolesMapping" x WHERE x."roleId" = r.id AND x."menuId" = m.id);
