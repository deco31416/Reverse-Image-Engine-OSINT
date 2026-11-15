const { spawn } = require('node:child_process');
const port = process.env.PORT || '3003';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid PORT');
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', port], { stdio: 'inherit', env: process.env });
server.on('error', () => { console.error('Dashboard could not start'); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 1; });
