// THE APP'S MENU KEYS — one place, used by App.jsx and Configure UI → Menu.
//
// A key is a `menus` row's name: what the side rail and the settings menu match
// on. It never changes. What people read is that row's LABEL, renamed in
// Configure UI → Menu — so no label is written anywhere in code.

/** A form added to the menu from Configure UI is the menu row "form:<its key>". */
export const FORM_MENU_PREFIX = 'form:'

/** Every key this app shows — Configure UI → Menu lists these, and the forms added to the menu. */
export const APP_MENU_KEYS = [
  'Home',
  'Monitor',
  'Tasks',
  'Flows',
  'Admin',
  'Configure UI'
]
