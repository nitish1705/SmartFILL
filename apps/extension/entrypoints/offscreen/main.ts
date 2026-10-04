import { browser } from 'wxt/browser';
import { env, pipeline } from '@huggingface/transformers';
import { createEmbeddingIndex, type Embedder, type FieldInfo } from '@smartfill/core';

/**
 * Offscreen document: keeps the MiniLM model (bundled, ONNX/WASM) warm and ranks
 * form fields against the key registry. No network access is needed or used.
 */
const url = (path: string) => browser.runtime.getURL(path as never);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false; // the Cache API rejects chrome-extension:// requests
env.localModelPath = url('/models/');
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.wasmPaths = url('/ort/');
  wasm.numThreads = 1;
  wasm.proxy = false;
}

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractor: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null;

const embed: Embedder = async (texts) => {
  if (texts.length === 0) return [];
  extractor ??= pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  const run = (await extractor) as unknown as (
    t: string[],
    o: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ tolist(): number[][] }>;
  return (await run(texts, { pooling: 'mean', normalize: true })).tolist();
};

const index = createEmbeddingIndex(embed);

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { target?: string; type?: string; fields?: FieldInfo[] } | undefined;
  if (m?.target !== 'offscreen' || m.type !== 'rank' || !m.fields) return undefined;
  return index
    .rank(m.fields)
    .then((ranked) => ({ ok: true as const, ranked }))
    .catch((e: unknown) => {
      extractor = null; // allow a retry (e.g. model files missing)
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    });
});
