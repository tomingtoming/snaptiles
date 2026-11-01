# Build the core for the browser: one ES module (snaptiles_core.js + snaptiles_core.wasm) in core/pkg.
# Needs emsdk (EMSDK, default C:\Users\<you>\emsdk, `emsdk install latest` + `activate latest`) and the Rust target
# wasm32-unknown-emscripten. Only this process's environment is changed.
$ErrorActionPreference = 'Continue' # cargo reports progress on stderr; failures are judged by exit codes
$emsdk = if ($env:EMSDK) { $env:EMSDK } else { Join-Path $env:USERPROFILE 'emsdk' }
$env:EMSDK = $emsdk
$env:EM_CONFIG = Join-Path $emsdk '.emscripten'
$env:EMSDK_PYTHON = (Get-ChildItem (Join-Path $emsdk 'python') -Directory | Select-Object -First 1).FullName + '\python.exe'
$env:PATH = "$emsdk\upstream\emscripten;$emsdk;$env:PATH"
# current emsdk ships emcc.exe/emar.exe launchers (no .bat), which the cc crate and rustc would otherwise look for
$em = "$emsdk\upstream\emscripten"
$env:CC_wasm32_unknown_emscripten = "$em\emcc.exe"
$env:AR_wasm32_unknown_emscripten = "$em\emar.exe"
$env:CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER = "$em\emcc.exe"
Push-Location $PSScriptRoot
try {
  cargo build --release --target wasm32-unknown-emscripten --bin snaptiles_core 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed ($LASTEXITCODE)" }
  $out = 'target\wasm32-unknown-emscripten\release'
  New-Item -ItemType Directory -Force pkg | Out-Null
  Copy-Item "$out\snaptiles_core.js", "$out\snaptiles_core.wasm" pkg -Force
  Get-ChildItem pkg | Select-Object Name, Length
} finally { Pop-Location }
