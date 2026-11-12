// FLOWS — how @xeplr/workflow-api starts, inside this API.
//
//   ITS OWN DATABASE   DB_WORKFLOW, beside yours rather than in it — a
//                      sub-product embedded in an app gets a store of its own.
//                      Created and migrated on first start, with the same
//                      server login as the app (XEPLR_MONITOR_CONNECTION).
//   THIS APP'S         it registers no tenancy of its own: flows and runs are
//   TENANCY            filtered by the levels this app registered (or none),
//                      behind this app's membership gate.
//   PERMISSIONS        every route checks the caller's ("List flows", "Start
//                      flow run"…), granted by @xeplr/workflow-api's
//                      migrations-auth, which XEPLR_AUTH_MIGRATIONS loads.
//
// A flow's "let a function decide" picks one of this app's functions
// (functions/), the same registry the screens' events use.
var { registerWorkflow } = require('@xeplr/workflow-api');

/** Creates and migrates workflow's database, and returns its router — already gated. */
module.exports = async function startWorkflow(memberGate) {
  var workflow = await registerWorkflow({
    applicationId: 'xeplr-monitor',
    db: {
      name: process.env.DB_WORKFLOW,
      connection: process.env.XEPLR_MONITOR_CONNECTION,
      connectionName: 'workflow'
    },
    tenantTables: false,
    access: true,
    mtMembershipGate: memberGate
  });
  return workflow.router;
};
