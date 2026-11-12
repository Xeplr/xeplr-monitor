// WHO MAY DO WHAT — beyond the permission catalog every route already checks.
//
// Designing screens, making new forms and publishing them change the
// database's tables, so they are kept to Super Admin alone, whatever else a
// role has been granted. Relax superAdminOnly here when your app has decided
// who else should.

var FORBIDDEN = { code: 'FORBIDDEN', message: 'Only Super Admin can design and publish forms', error: null, dataArray: [] };

function isSuperAdmin(req) {
  var roles = (req.access && req.access.roles) || (req.user && req.user.roles) || [];
  return roles.indexOf('Super Admin') !== -1;
}

function superAdminOnly(req, res, next) {
  if (isSuperAdmin(req)) return next();
  res.status(403).send(FORBIDDEN);
}

/** No check of its own — the token and the permission catalog still apply. */
function anyone(req, res, next) {
  next();
}

module.exports = { isSuperAdmin: isSuperAdmin, superAdminOnly: superAdminOnly, anyone: anyone };
