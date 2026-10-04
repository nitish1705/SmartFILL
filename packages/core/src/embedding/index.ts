import { splitIdentifier } from '../normalize';
import calibrationJson from './calibration.json';
import { REGISTRY } from '../registry/keys';
import type { FieldInfo } from '../types';

/** Embeds texts into unit-length vectors. Provided by the offscreen document or a Node test harness. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface EmbeddingCandidate {
  key: string;
  /** raw cosine similarity */
  cosine: number;
  /** calibrated probability-like score */
  score: number;
}

/** Platt scaling: p = 1 / (1 + exp(-(a·cos + b))). Fitted by `npm run calibrate`. */
export interface Calibration {
  a: number;
  b: number;
}
export const DEFAULT_CALIBRATION: Calibration = calibrationJson;

export const EMBEDDING_ACCEPT = 0.8;
export const EMBEDDING_MARGIN = 0.08;
/** Embeddings alone never reach the auto band. */
export const EMBEDDING_CAP = 0.94;

export function calibrate(cosine: number, cal: Calibration = DEFAULT_CALIBRATION): number {
  return 1 / (1 + Math.exp(-(cal.a * cosine + cal.b)));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are normalized
}

const words = (s: string | undefined) => (s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * `label | placeholder`, falling back to nearby text, aria-label, then the section heading and identifiers.
 * The section heading is deliberately not mixed into labelled fields: on the fixtures it halved accuracy
 * ("author 2 | email" pulled everything toward the heading's meaning).
 */
export function fieldText(f: FieldInfo): string {
  const c = f.context;
  const primary = words(c.label) || words(c.ariaLabel) || words(c.nearbyText);
  const parts = [primary, words(c.placeholder)].filter(Boolean);
  if (parts.length === 0) {
    parts.push(words(c.sectionHeading), words(splitIdentifier(c.name ?? c.id ?? '')));
  }
  return parts.filter(Boolean).join(' | ').toLowerCase();
}

interface KeyAnchor {
  key: string;
  text: string;
}

/** One anchor for label+description and one per synonym; a key's similarity is the max over its anchors. */
export function keyAnchors(): KeyAnchor[] {
  return REGISTRY.flatMap((d) => [
    { key: d.key, text: `${d.label}. ${d.description}`.toLowerCase() },
    ...d.synonyms.map((s) => ({ key: d.key, text: s })),
  ]);
}

export interface EmbeddingIndex {
  /** Rank keys for each field. Fields with no usable text get an empty list. */
  rank(fields: FieldInfo[]): Promise<EmbeddingCandidate[][]>;
}

/** Key-anchor vectors are computed once per embedder and reused across pages. */
const ANCHOR_CACHE = new WeakMap<Embedder, Promise<number[][]>>();

export function createEmbeddingIndex(embed: Embedder, calibration: Calibration = DEFAULT_CALIBRATION): EmbeddingIndex {
  const anchors = keyAnchors();

  return {
    async rank(fields) {
      let anchorVectors = ANCHOR_CACHE.get(embed);
      if (!anchorVectors) {
        anchorVectors = embed(anchors.map((a) => a.text));
        ANCHOR_CACHE.set(embed, anchorVectors);
        anchorVectors.catch(() => ANCHOR_CACHE.delete(embed));
      }
      const texts = fields.map(fieldText);
      const live = texts.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
      const [keyVecs, fieldVecs] = await Promise.all([anchorVectors, embed(live.map((i) => texts[i]!))]);

      const out: EmbeddingCandidate[][] = fields.map(() => []);
      live.forEach((fi, n) => {
        const best = new Map<string, number>();
        anchors.forEach((a, ai) => {
          const c = cosine(fieldVecs[n]!, keyVecs[ai]!);
          if (c > (best.get(a.key) ?? -1)) best.set(a.key, c);
        });
        out[fi] = [...best]
          .map(([key, cos]) => ({ key, cosine: cos, score: calibrate(cos, calibration) }))
          .sort((x, y) => y.score - x.score)
          .slice(0, 5);
      });
      return out;
    },
  };
}

/** Accept the embedding top-1 only if calibrated score and margin are high enough (§7.5). */
export function embeddingAccepted(c: EmbeddingCandidate[]): boolean {
  const [top, second] = c;
  return !!top && top.score >= EMBEDDING_ACCEPT && top.score - (second?.score ?? 0) >= EMBEDDING_MARGIN;
}
