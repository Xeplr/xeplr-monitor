-- "Home" — this app's own drawer item, matching the name used in the UI's
-- drawerItems list (ui/src/App.jsx), by key. Its label is changed in Configure UI → Menu.
--
-- Without this row the item is dropped from the drawer SILENTLY: the name has
-- to exist here for @xeplr/ui-account to show it, and an unrecognised one
-- produces no error anywhere.
--
-- isPublic: every signed-in user should see Home, whatever their role.

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Home', '', true, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Home');

UPDATE "menus" SET "isPublic" = true WHERE name = 'Home';
