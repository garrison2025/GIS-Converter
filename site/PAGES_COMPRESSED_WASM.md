# Pages compressed GDAL/WASM — experimental
The raw gdal3.js WASM file is 28,219,835 bytes (>25 MiB Pages file limit), but gzip is 9,110,773 bytes.
This build uses a Pages Function at /engine/gdal3/gdal3WebAssembly.wasm to serve the static .wasm.gz bytes with Content-Encoding: gzip.
- Run npm run build then npm run prepare:pages; the 28MB raw file is deleted from dist.
- Only the exact wasm URL invokes a Pages Function through _routes.json; all other assets remain static.
- A real browser Wrangler Pages local smoke test is required before considering this viable; real Cloudflare deployment and billing quotas remain untested.
- Never commit/payment keys or deploy production automatically.
- If this approach fails on live Cloudflare, fallback to R2 public asset hosting with CORS and verified caching.
