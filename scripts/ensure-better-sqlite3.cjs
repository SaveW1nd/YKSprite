const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRequire } = require('node:module');

const serviceDir = path.join(__dirname, '..', 'apps', 'service');
const serviceRequire = createRequire(path.join(serviceDir, 'package.json'));

function verify() {
  try {
    const Database = serviceRequire('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('select 1');
    db.close();
    return true;
  } catch (error) {
    console.warn('[postinstall] better-sqlite3 verification failed:', error.message);
    return false;
  }
}

if (!verify()) {
  const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: serviceDir,
    stdio: 'inherit'
  });

  if (rebuild.status !== 0 || !verify()) {
    console.error('[postinstall] better-sqlite3 is still unavailable after rebuild.');
    process.exit(rebuild.status || 1);
  }
}

console.log('[postinstall] better-sqlite3 ready');
