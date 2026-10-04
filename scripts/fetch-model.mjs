// Downloads the quantized MiniLM embedding model and copies the onnxruntime wasm
// files so the extension can run fully offline. Files are gitignored (≈23 MB).
//   npm run fetch-model
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.SMARTFILL_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const BASE = `https://huggingface.co/${MODEL}/resolve/main`;
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

const modelDir = join(root, 'apps/extension/public/models', MODEL);
for (const f of FILES) {
  const out = join(modelDir, f);
  if (existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', f);
}

const ortDir = join(root, 'apps/extension/public/ort');
mkdirSync(ortDir, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) {
  copyFileSync(join(root, 'node_modules/onnxruntime-web/dist', f), join(ortDir, f));
}
console.log('model ready in', modelDir);
