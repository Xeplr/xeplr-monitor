// The model for task records — how values are shaped between your code and
// the "tasks" table, like Sequelize's getters and setters.
//
// Register with @xeplr/factory:  factory.init({ knex, models: [require('./task.model')] })
//
// Used everywhere: the screens' routes and factory.table('tasks'). Models shape
// data; the functions its events name decide behaviour (api/functions/).

var { FactoryModel } = require('@xeplr/factory');

class TaskModel extends FactoryModel {
  static table = 'tasks';

  // Per field: set(value, values) before it is written, get(value, row) after it is read.
  //   tags: { set: (v) => (Array.isArray(v) ? v.join(',') : v), get: (v) => (v ? v.split(',') : []) }
  static fields = {};

  /** Every value about to be written. Override for more than one field at a time. */
  static toDb(values) {
    return super.toDb(values);
  }

  /** Every row just read. */
  static fromDb(row) {
    return super.fromDb(row);
  }
}

module.exports = TaskModel;
