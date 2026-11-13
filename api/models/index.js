// The monitor's tables (migrations/0001_monitor.sql), each a class extending
// @xeplr/db's BaseModel, used by lib/services.js.
var { BaseModel } = require('@xeplr/db');

// The systemd services the monitor watches (migrations/0001_monitor.sql).
class MonitoredService extends BaseModel {
  static get tableName() { return 'monitor_services'; }
  static get jsonSchema() { return BaseModel.schema({ required: ['unit', 'label'] }); }
}

// Every change made through the monitor, refused ones too.
class MonitorAudit extends BaseModel {
  static get tableName() { return 'monitor_audit'; }
  static get jsonSchema() { return BaseModel.schema({ required: ['action', 'ok'] }); }
}


module.exports = { MonitoredService: MonitoredService, MonitorAudit: MonitorAudit };
