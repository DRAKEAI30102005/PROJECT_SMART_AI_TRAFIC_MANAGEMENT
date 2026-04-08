import { spawn } from 'node:child_process';

const children = [];

function startProcess(command, args, name) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}.`);
    }
  });

  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startProcess('npx', ['tsx', 'server/index.ts'], 'API');
startProcess('npx', ['vite', '--port=3000', '--host=0.0.0.0'], 'Vite');
