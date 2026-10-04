import { DEFAULT_SETTINGS, type Thresholds } from '@smartfill/schemas';
import { decideBand, moreCautious } from '../decide';
import {
  EMBEDDING_CAP,
  createEmbeddingIndex,
  embeddingAccepted,
  type Embedder,
  type Calibration,
  type EmbeddingCandidate,
} from '../embedding';
import { LLM_BATCH_SIZE, LLM_TIMEOUT_MS, buildLlmRequest, llmCandidateKeys, parseLlmResponse, type LlmRequest } from '../llm';
import { getKeyDef } from '../registry/keys';
import { validateFill } from '../validate';
import { sensitiveReason } from '../validate/sensitive';
import type { Decision, FieldInfo, MatchLayer, MatchResult, ProfileValues } from '../types';
import { prepareField, rankCandidates, sectionConflict, type Candidate } from './rules';

export interface MatchOptions {
  values: ProfileValues;
  thresholds?: Thresholds;
}

/** Optional signals from layers beyond the deterministic rules. */
export interface ExtraSignals {
  /** Learned per-site mapping (Layer 0). */
  site?: { key: string | 'IGNORE' };
  /** Calibrated embedding candidates (Layer 2). */
  embedding?: EmbeddingCandidate[];
  /** Constrained LLM choice (Layer 3). */
  llm?: { key: string | null; confidence: number };
}

export interface MatchServices {
  embed?: Embedder;
  /** Alternative to `embed`: rank fields remotely (offscreen document keeps key vectors warm). */
  rank?: (fields: FieldInfo[]) => Promise<EmbeddingCandidate[][]>;
  /** Constrained LLM fallback (Layer 3). Receives only field descriptions + candidate keys; returns untrusted JSON. */
  llm?: (request: LlmRequest) => Promise<unknown>;
  /** Observe exactly what is sent to the LLM (privacy transparency). */
  onLlmRequest?: (request: LlmRequest) => void;
  /** Override the fitted Platt calibration (tests, experiments). */
  calibration?: Calibration;
  /** Learned site mapping lookup (Layer 0). */
  site?: (f: FieldInfo) => string | 'IGNORE' | undefined;
}

const RULE_ACCEPT = 0.9;
const RULE_MARGIN = 0.15;
const AMBIGUOUS_CAP = 0.79;
const LLM_CAP = 0.9;
const DISAGREE_PENALTY = 0.1;

interface FormFlags {
  /** The form has dedicated first/last name fields, so a bare "Name" is not the full name. */
  hasSplitName: boolean;
  /** Author-block index that belongs to the user (lowest one on the page). */
  primaryAuthorIndex?: number;
}

function formFlags(fields: FieldInfo[]): FormFlags {
  let hasSplitName = false;
  const indices = new Set<number>();
  for (const f of fields) {
    if (f.context.authorIndex !== undefined) indices.add(f.context.authorIndex);
    const top = rankCandidates(f)[0];
    if (top && top.score >= RULE_ACCEPT && (top.key === 'personal.first_name' || top.key === 'personal.last_name')) {
      hasSplitName = true;
    }
  }
  const sorted = [...indices].sort((a, b) => a - b);
  return { hasSplitName, primaryAuthorIndex: indices.size > 1 ? sorted[0] : undefined };
}

function result(f: FieldInfo, partial: Partial<MatchResult> & Pick<MatchResult, 'decision' | 'reason'>): MatchResult {
  return { fieldId: f.fieldId, key: null, confidence: 0, layer: 'rule', candidates: [], ...partial };
}

interface Proposal {
  layer: MatchLayer;
  key: string;
  score: number;
}

/** Confidence fusion (§7.7). */
function fuse(picks: Proposal[]): { key: string; confidence: number; layer: MatchLayer; disagree: boolean } {
  const sorted = [...picks].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  const other = sorted.find((p) => p.key !== top.key);
  if (other) {
    return {
      key: top.key,
      layer: top.layer,
      confidence: Math.min(Math.min(top.score, other.score) - DISAGREE_PENALTY, AMBIGUOUS_CAP),
      disagree: true,
    };
  }
  return { key: top.key, confidence: top.score, layer: top.layer, disagree: false };
}

export interface Matched {
  result: MatchResult;
  /** Rules were not conclusive; later layers may help. */
  needsMore: boolean;
}

function matchOne(
  f: FieldInfo,
  opts: Required<MatchOptions>,
  flags: FormFlags,
  extra: ExtraSignals = {},
): Matched {
  const { values, thresholds } = opts;
  const done = (r: MatchResult): Matched => ({ result: r, needsMore: false });

  const blockedReason = sensitiveReason(f);
  if (blockedReason) return done(result(f, { decision: 'blocked', reason: blockedReason }));

  if (
    flags.primaryAuthorIndex !== undefined &&
    f.context.authorIndex !== undefined &&
    f.context.authorIndex !== flags.primaryAuthorIndex
  ) {
    return done(result(f, { decision: 'skip', reason: 'belongs to another author (multi-author fill arrives in V2)' }));
  }

  if (extra.site?.key === 'IGNORE') {
    return done(result(f, { decision: 'skip', layer: 'site', reason: 'you told SmartFill to ignore this field here' }));
  }

  const pf = prepareField(f);
  let cands: Candidate[] = rankCandidates(f, pf);

  // "Name" next to first/last fields is not the full name.
  if (flags.hasSplitName) {
    cands = cands
      .map((c) => (c.key === 'personal.full_name' && c.signal !== 'autocomplete' ? { ...c, score: c.score - 0.4 } : c))
      .sort((a, b) => b.score - a.score);
  }

  const top = cands[0];
  const second = cands[1];
  const ruleOk = !!top && top.score >= thresholds.ask;
  const ambiguous = ruleOk && !!second && top.score - second.score < RULE_MARGIN;
  const ruleConclusive = ruleOk && top.score >= RULE_ACCEPT && !ambiguous;

  const picks: Proposal[] = [];
  let reason = '';
  if (extra.site) {
    picks.push({ layer: 'site', key: extra.site.key, score: 0.99 });
    reason = 'learned from your earlier correction on this site';
  } else {
    const conflict = sectionConflict(pf);
    if (ruleOk) {
      picks.push({
        layer: top.signal === 'autocomplete' ? 'autocomplete' : 'rule',
        key: top.key,
        score: ambiguous ? Math.min(top.score, AMBIGUOUS_CAP) : top.score,
      });
      reason = ambiguous
        ? `ambiguous between ${top.key} and ${second!.key}`
        : top.signal !== 'autocomplete' && top.score < RULE_ACCEPT
          ? `weak ${top.signal} match`
          : `${top.signal} match`;
    }
    const emb = extra.embedding;
    // Fields about someone else (billing, guardian…) never get a semantic or LLM fill.
    if (emb && !conflict && embeddingAccepted(emb)) {
      picks.push({ layer: 'embedding', key: emb[0]!.key, score: Math.min(emb[0]!.score, EMBEDDING_CAP) });
    }
    if (extra.llm?.key && !conflict) {
      picks.push({ layer: 'llm', key: extra.llm.key, score: Math.min(extra.llm.confidence, LLM_CAP) });
    }
  }

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const mergedCandidates = [
    ...cands.map((c) => ({ key: c.key, score: c.score })),
    ...(extra.embedding ?? []).map((c) => ({ key: c.key, score: c.score })),
  ];
  const seen = new Set<string>();
  const candidates = mergedCandidates
    .sort((a, b) => b.score - a.score)
    .filter((c) => !seen.has(c.key) && !!seen.add(c.key))
    .slice(0, 3)
    .map((c) => ({ key: c.key, score: round(c.score) }));

  const needsMore = !extra.site && !ruleConclusive;

  if (picks.length === 0) {
    return {
      needsMore,
      result: result(f, {
        decision: 'skip',
        reason: 'no confident match',
        candidates,
        confidence: round(top?.score ?? extra.embedding?.[0]?.score ?? 0),
      }),
    };
  }

  const fused = fuse(picks);
  if (fused.disagree) reason = `layers disagree (${picks.map((p) => `${p.layer}:${p.key}`).join(' vs ')})`;
  else if (picks.length > 1) reason = `${picks.map((p) => p.layer).join(' + ')} agree`;
  else if (fused.layer === 'embedding') reason = 'semantic match';
  else if (fused.layer === 'llm') reason = 'LLM chose among candidate keys';

  const base = { key: fused.key, confidence: round(fused.confidence), layer: fused.layer, candidates };
  const finish = (r: MatchResult): Matched => ({ result: r, needsMore });

  const def = getKeyDef(fused.key);
  if (!def) return finish(result(f, { ...base, decision: 'skip', reason: 'unknown key' }));
  if (def.sensitive) return finish(result(f, { ...base, decision: 'blocked', reason: 'sensitive profile key' }));

  const verdict = validateFill(def, values[fused.key], f);
  if (verdict.verdict === 'skip') {
    return finish(result(f, { ...base, decision: 'skip', reason: verdict.reason ?? 'cannot fill' }));
  }

  let decision: Decision = decideBand(fused.confidence, thresholds);
  if (verdict.verdict === 'review') {
    decision = moreCautious(decision, 'review');
    reason = verdict.reason ?? reason;
  }
  if (decision === 'skip' || decision === 'ask' || verdict.fillValue === undefined) {
    return finish(result(f, { ...base, decision, reason }));
  }
  const preview = f.controlType === 'select' ? values[fused.key]!.trim() : verdict.fillValue;
  return finish(result(f, { ...base, decision, reason, value: verdict.fillValue, preview }));
}

function normalizeOptions(options: MatchOptions): Required<MatchOptions> {
  return { values: options.values, thresholds: options.thresholds ?? DEFAULT_SETTINGS.thresholds };
}

/** Rules-only matching (synchronous). */
export function matchFields(fields: FieldInfo[], options: MatchOptions): MatchResult[] {
  const opts = normalizeOptions(options);
  const flags = formFlags(fields);
  return fields.map((f) => matchOne(f, opts, flags).result);
}

function siteExtra(f: FieldInfo, lookup: MatchServices['site']): ExtraSignals {
  const key = lookup?.(f);
  return key ? { site: { key } } : {};
}

/** Full cascade: site memory → rules → embeddings. Embeddings run only for fields rules could not settle. */
export async function matchFieldsAsync(
  fields: FieldInfo[],
  options: MatchOptions,
  services: MatchServices = {},
): Promise<MatchResult[]> {
  const opts = normalizeOptions(options);
  const flags = formFlags(fields);
  const extras: ExtraSignals[] = fields.map((f) => siteExtra(f, services.site));
  let matched = fields.map((f, i) => matchOne(f, opts, flags, extras[i]));

  const rank = services.rank ?? (services.embed ? createEmbeddingIndex(services.embed, services.calibration).rank : undefined);
  if (rank) {
    // needsMore is false for blocked, other-author and ignored fields, so those never reach a model.
    const eligible = matched.map((m, i) => (m.needsMore ? i : -1)).filter((i) => i >= 0);
    if (eligible.length) {
      try {
        const ranked = await rank(eligible.map((i) => fields[i]!));
        eligible.forEach((fi, n) => {
          extras[fi] = { ...extras[fi], embedding: ranked[n] };
          matched[fi] = matchOne(fields[fi]!, opts, flags, extras[fi]);
        });
      } catch {
        /* embedding layer unavailable → rules-only result stands */
      }
    }
  }
  if (services.llm) {
    // Only fields still unsettled (skipped or merely "unsure") whose candidate keys have profile values.
    const asks = matched
      .map((m, i) => ({ i, m }))
      .filter(({ m }) => m.needsMore && (m.result.decision === 'skip' || m.result.decision === 'ask'))
      .map(({ i, m }) => ({ i, candidates: llmCandidateKeys(m.result.candidates, opts.values) }))
      .filter((a) => a.candidates.length > 0);
    for (let at = 0; at < asks.length; at += LLM_BATCH_SIZE) {
      const batch = asks.slice(at, at + LLM_BATCH_SIZE);
      const request = buildLlmRequest(batch.map((a) => ({ field: fields[a.i]!, candidates: a.candidates })));
      try {
        services.onLlmRequest?.(request);
        const raw = await Promise.race([
          services.llm(request),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT_MS)),
        ]);
        const picks = parseLlmResponse(raw, request, opts.values);
        for (const a of batch) {
          const pick = picks.get(fields[a.i]!.fieldId);
          if (!pick?.key) continue;
          extras[a.i] = { ...extras[a.i], llm: { key: pick.key, confidence: pick.confidence } };
          matched[a.i] = matchOne(fields[a.i]!, opts, flags, extras[a.i]);
        }
      } catch {
        /* timeout / network / bad response → keep the embedding+rules result silently */
      }
    }
  }
  return matched.map((m) => m.result);
}

export interface FillCheck {
  ok: boolean;
  value?: string;
  preview?: string;
  /** Needs a human even when selected (e.g. maxlength exceeded). */
  review?: boolean;
  reason?: string;
}

/** Can `key` be written into `f` with the profile's value? Used when the user overrides a mapping. */
export function checkFill(f: FieldInfo, key: string, values: ProfileValues): FillCheck {
  const def = getKeyDef(key);
  if (!def) return { ok: false, reason: 'unknown key' };
  if (def.sensitive || sensitiveReason(f)) return { ok: false, reason: 'protected field' };
  const v = validateFill(def, values[key], f);
  if (v.verdict === 'skip' || v.fillValue === undefined) return { ok: false, reason: v.reason };
  return {
    ok: true,
    value: v.fillValue,
    preview: f.controlType === 'select' ? values[key]!.trim() : v.fillValue,
    review: v.verdict === 'review',
    reason: v.reason,
  };
}

/** Fields the deterministic rules could not settle: the only ones ever sent to later layers. */
export function escalationCandidates(fields: FieldInfo[], options: MatchOptions): FieldInfo[] {
  const opts = normalizeOptions(options);
  const flags = formFlags(fields);
  return fields.filter((f) => matchOne(f, opts, flags).needsMore);
}
