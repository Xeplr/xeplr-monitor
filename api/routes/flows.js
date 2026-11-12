// FLOWS — screens one after another, run by @xeplr/workflow-api inside this
// API (bin/www starts it; workflow.js says where its data lives).
//
// Mounted by routes/index.js at /api/workflow, behind this app's auth gate:
//   /api/workflow/flows       the flows people walk through (Journey) and design
//   /api/workflow/workflows   the workflow document API underneath
var express = require('express');

var router = express.Router();
var workflow = null;

router.use(function(req, res, next) {
  // Only before startup has finished — bin/www mounts it before listening.
  if (!workflow) return res.status(503).json({ message: 'Flows are still starting' });
  return workflow(req, res, next);
});

/** bin/www hands over registerWorkflow's router, already gated. */
router.mount = function(workflowRouter) {
  workflow = workflowRouter;
};

module.exports = router;
