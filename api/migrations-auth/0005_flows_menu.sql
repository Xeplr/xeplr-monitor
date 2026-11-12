-- "Flows" — the side-rail item for journeys across the app's forms.
--
-- ALWAYS THERE: flows are run by @xeplr/workflow inside this app's own API,
-- so there is nothing to switch on.
--
-- The name is the KEY: it must match ui/src/App.jsx's drawerItems `key`
-- EXACTLY. What people read is the label, changed in Configure UI → Menu.
-- (0005, not 0004: a multi-tenant app's own 0004 is the switch menu.)

INSERT INTO "menus" (id, name, "menuGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'Flows', '', true, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE name = 'Flows');

UPDATE "menus" SET "isPublic" = true WHERE name = 'Flows';
