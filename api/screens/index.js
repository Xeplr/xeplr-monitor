// THE SCREENS THIS APP SHIPS WITH — designed with @xeplr/ui-factory.
//
// Each entity is two screens: a list, and the add / edit form the list opens
// in a popup. Their records live in a REAL table named for the entity
// ("tasks"), one column per field.
//
// On startup (bin/www) every screen here that has never been published is
// published — which creates its table. After that the DATABASE holds the
// design: change it in the app's Configure UI → Forms, where Publish changes the
// table to match. Editing a .screen.json later changes nothing for an
// already-published screen.
//
// ADD ONE: follow "Create a new UI" in the project's CLAUDE.md — or ask Claude
// to, with the prompt there. Every form's folder holds the same files:
//
//   screens/<form>/<form>.entity.json       its name and fields
//   screens/<form>/<form>-list.screen.json  the list
//   screens/<form>/<form>-edit.screen.json  the add / edit form
//   screens/<form>/<form>.model.js          server model — getters / setters
//
// Code around a form's records — checks on save, an email after — is not in
// these folders: it is a FUNCTION in functions/, named in the screen's
// `events` (task-edit.screen.json names tidyTaskTitle).

module.exports = {
  // Publish order is worked out for you: a table before the dropdowns that
  // point at it, lists last.
  documents: [
    require('./task/task-edit.screen.json'),
    require('./task/task-list.screen.json')
  ],

  // How each table's values are shaped — see task/task.model.js.
  models: [
    require('./task/task.model')
  ]
};
