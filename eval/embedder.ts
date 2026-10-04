import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from '@smartfill/core';

const MODEL_ROOT = join(__dirname, '..', 'apps', 'extension', 'public', 'models');
export const MODEL = process.env.SMARTFILL_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
export const modelAvailable = () => existsSync(join(MODEL_ROOT, MODEL, 'onnx', 'model_quantized.onnx'));

/** Node embedder using the same bundled MiniLM model as the extension (run `npm run fetch-model` first). */
export async function createNodeEmbedder(): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = MODEL_ROOT + '/';
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return async (texts) => {
    if (texts.length === 0) return [];
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    return out.tolist() as number[][];
  };
}
