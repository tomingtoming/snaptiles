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
  const defaultScripts = ['editor-probe.mjs', 'editor-build-probe.mjs', 'load-probe.mjs', 'editor-error-recovery-probe.mjs', 'editor-unsupported-part-probe.mjs', 'editor-failed-view-probe.mjs', 'editor-section-warning-probe.mjs', 'editor-file-probe.mjs', 'editor-load-history-probe.mjs', 'editor-share-probe.mjs', 'editor-option-probe.mjs', 'editor-color-probe.mjs', 'editor-cowl-probe.mjs', 'editor-keyboard-probe.mjs', 'editor-help-probe.mjs', 'editor-touch-probe.mjs', 'editor-mixed-input-probe.mjs', 'editor-direction-probe.mjs', 'editor-edge-count-probe.mjs', 'editor-view-direction-probe.mjs', 'editor-framing-probe.mjs', 'editor-source-history-probe.mjs', 'editor-short-height-probe.mjs', 'editor-source-help-probe.mjs', 'editor-caret-probe.mjs', 'editor-selection-probe.mjs', 'editor-branch-workflow-probe.mjs', 'editor-move-probe.mjs', 'editor-name-probe.mjs', 'editor-named-copy-probe.mjs', 'editor-copy-dependencies-probe.mjs', 'editor-search-probe.mjs', 'editor-move-script-probe.mjs', 'runtime-framing-probe.mjs', 'editor-filename-probe.mjs', 'editor-recovery-probe.mjs', 'editor-mirror-probe.mjs', 'editor-control-keys-probe.mjs', 'editor-separate-control-probe.mjs', 'editor-custom-keys-probe.mjs', 'editor-key-usage-probe.mjs', 'editor-throttle-probe.mjs'];
  for (const script of (process.argv.length > 2 ? process.argv.slice(2) : defaultScripts)) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), url], {cwd:root, stdio:'inherit', windowsHide:true});
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${script} exceeded 120s`)); }, 120000);
      child.on('error', error => {clearTimeout(timer); reject(error);});
      child.on('exit', code => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`));});
    });
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
