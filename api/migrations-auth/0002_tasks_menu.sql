-- "Tasks" — the drawer item for the sample page.
--
-- The name is the KEY: it must match ui/src/App.jsx's drawerItems `key` EXACTLY.
-- What people read is the label, changed in Configure UI → Menu.
-- @xeplr/ui-account drops unrecognised names silently, so a typo removes the
-- item with no error anywhere.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Tasks', '', true, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Tasks');

UPDATE "menus" SET "isPublic" = true WHERE name = 'Tasks';
