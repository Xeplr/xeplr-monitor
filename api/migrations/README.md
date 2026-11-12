# migrations

Hand-written `.sql` files, applied once each, in name order, every time the API
starts (`0001_something.sql`, `0002_…`).

**Tables for screens are not written here.** A screen's table (`tasks`) is
created and changed by **Publish** in Configure UI → Forms — see `screens/`.

Put here only tables no screen owns: lookup data, a table your own code writes.
