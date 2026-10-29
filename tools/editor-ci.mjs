// Runs the real editor flows against dist on an OS-assigned port.
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await preview({root, preview:{host:'127.0.0.1', port:0, strictPort:true, open:false}});
try {
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview did not bind a TCP port');
  const url = `http://127.0.0.1:${address.port}/`;
  for (const script of ['editor-probe.mjs', 'editor-build-probe.mjs', 'load-probe.mjs', 'editor-file-probe.mjs', 'editor-share-probe.mjs', 'editor-option-probe.mjs']) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), url], {cwd:root, stdio:'inherit', windowsHide:true});
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${script} exceeded 120s`)); }, 120000);
      child.on('error', error => {clearTimeout(timer); reject(error);});
      child.on('exit', code => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`));});
    });
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
