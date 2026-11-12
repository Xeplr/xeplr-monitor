// THIS APP'S FUNCTIONS — the code a screen's events and a flow's "let a
// function decide" run. Loaded once at startup (bin/www), before the screens.
//
// A function is registered under the EVENT it is written for, and picked BY
// NAME in the designer: Configure UI → Flows → a step → Events & navigation
// (or a screen's own `events` in its .screen.json). The designer only ever
// sees the name, the description and what the event hands it — the code
// stays here, and runs on the server.
//
//   event          runs                                   ctx adds              return
//   beforeLoad     before records are read                query (narrow it)     nothing, or a new query
//   beforeSave     before a record is written             values, isNew,        the values to save
//                                                         previous
//   afterSave      once it is saved                       result                (ignored)
//   beforeDelete   before a delete                        previous              nothing
//   onError        when load / save / delete failed       error                 (ignored)
//   decide         a flow step is done: where next?       values, targets       a step key
//
// Every ctx has user, tenant, knex, db() (this form's table, scoped) and
// reject(message, { field }) — which refuses with the message on that field.
//
// A screen that names a function nobody registered is refused when it is
// published, by name — so renaming one here means renaming it there too.
// Add files beside this one and require them below as the app grows.
var { register } = require('@xeplr/actions');

register({
  name: 'tidyTaskTitle',
  event: 'beforeSave',
  description: 'Trims a task\'s title and squeezes repeated spaces, so "  Plant   seeds " is saved as "Plant seeds".',
  execute: function(ctx) {
    var title = String(ctx.values.title || '').replace(/\s+/g, ' ').trim();
    if (!title) ctx.reject('A task needs a title', { field: 'title' });
    return Object.assign({}, ctx.values, { title: title });
  }
});

register({
  name: 'byPriority',
  event: 'decide',
  description: 'High-priority tasks go to the first screen it may choose; everything else to the second.',
  execute: function(ctx) {
    // ctx.targets: the steps ticked under "It may choose", in the flow's order.
    var high = ctx.values && ctx.values.priority === 'high';
    return high ? ctx.targets[0] : (ctx.targets[1] || ctx.targets[0]);
  }
});
