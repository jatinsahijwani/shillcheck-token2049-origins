// Dev-box process set. Secrets stay in .env / .local; nothing here is secret.
const path = require('node:path');
const root = __dirname;
const logs = path.join(root, '.local', 'logs');
const log = (name) => ({ out_file: path.join(logs, `${name}.out.log`), error_file: path.join(logs, `${name}.err.log`), merge_logs: true, time: true });
const base = { cwd: root, instances: 1, exec_mode: 'fork', autorestart: true, max_restarts: 20, min_uptime: '10s', restart_delay: 3000 };
module.exports = {
  apps: [
    // Masumi Payment Service: same built tree, reads its own .env from its cwd. Loopback only.
    { name: 'shillcheck-mps', script: 'dist/index.js', cwd: path.resolve(root, '..', 'shillcheck-mps'), instances: 1, exec_mode: 'fork', autorestart: true, max_restarts: 20, min_uptime: '10s', restart_delay: 3000, ...log('mps') },
    // start.mjs only runs when it is the entry file, which pm2's fork wrapper hides, so run it with plain node.
    { name: 'shillcheck-eve', script: process.execPath, args: ['--env-file-if-exists=.env', '--env-file-if-exists=.local/priceproof-purchase.env', 'start.mjs'], interpreter: 'none', ...base, ...log('eve') },
    // PriceProof: separate deterministic Standard API on its own loopback port. Not started until it is registered.
    { name: 'shillcheck-priceproof', script: 'priceproof/server.mjs', node_args: ['--env-file-if-exists=.env', '--env-file-if-exists=.local/priceproof-runtime.env'], ...base, ...log('priceproof') },
    { name: 'shillcheck-api', script: 'agent-api.mjs', node_args: ['--env-file-if-exists=.env', '--env-file-if-exists=.local/mps-runtime.env'], ...base, ...log('api') },
    // Exactly one worker: it also takes a lock file, so a second instance would refuse to start.
    { name: 'shillcheck-worker', script: 'worker.mjs', node_args: ['--env-file-if-exists=.env'], ...base, ...log('worker') },
  ],
};
