/**
 * pnpm hook file.
 * Fixes @ts-http/express which was published with "workspace:*" dependency
 * instead of the actual version for @ts-http/core.
 */
function readPackage(pkg) {
  if (pkg.name === '@ts-http/express' && pkg.dependencies?.['@ts-http/core'] === 'workspace:*') {
    pkg.dependencies['@ts-http/core'] = '^0.0.2';
  }
  return pkg;
}

module.exports = {
  hooks: { readPackage },
};
