-- "Configure UI" — in the settings menu (top right): every form (design, publish,
-- open, add to the menu) and the side rail's items (rename, reorder, hide).
-- ui/src/pages/ConfigureUI.jsx.
--
-- SUPER ADMIN ONLY: publishing changes database tables. The API refuses
-- everyone else as well (api/routes/access.js, and @xeplr/auth's menu routes).
--
-- The name is the KEY the app matches on (App.jsx settingsOverrides). What
-- people read is the label, which Configure UI → Menu can change.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Configure UI', '', false, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Configure UI');

INSERT INTO "menuRolesMapping" (id, "roleId", "menuId", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), r.id, m.id, true, '*', now(), now()
FROM "roles" r CROSS JOIN "menus" m
WHERE r.name = 'Super Admin'
  AND m.name = 'Configure UI'
  AND NOT EXISTS (SELECT 1 FROM "menuRolesMapping" x WHERE x."roleId" = r.id AND x."menuId" = m.id);
