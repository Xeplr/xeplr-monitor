// Models for tables you write by hand (see migrations/README.md) — each one a
// class extending @xeplr/db's BaseModel, handed to genericRoute in
// routes/index.js.
//
// Tables made as forms (Configure UI → Forms, screens/) need no model: @xeplr/factory saves
// and reads them from the screen itself.
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
