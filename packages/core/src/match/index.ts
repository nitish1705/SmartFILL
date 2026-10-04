import { DEFAULT_SETTINGS, type Thresholds } from '@smartfill/schemas';
import { decideBand, moreCautious } from '../decide';
import { getKeyDef } from '../registry/keys';
import { validateFill } from '../validate';
import { sensitiveReason } from '../validate/sensitive';
import type { Decision, FieldInfo, MatchResult, ProfileValues } from '../types';
import { prepareField, rankCandidates } from './rules';

export interface MatchOptions {
  values: ProfileValues;
  thresholds?: Thresholds;
}

const RULE_ACCEPT = 0.9;
const RULE_MARGIN = 0.15;
const AMBIGUOUS_CAP = 0.79;

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

/** Match a single field. `flags` carries form-level context. */
function matchOne(f: FieldInfo, opts: Required<MatchOptions>, flags: FormFlags): MatchResult {
  const { values, thresholds } = opts;

  const blockedReason = sensitiveReason(f);
  if (blockedReason) return result(f, { decision: 'blocked', reason: blockedReason });

  if (
    flags.primaryAuthorIndex !== undefined &&
    f.context.authorIndex !== undefined &&
    f.context.authorIndex !== flags.primaryAuthorIndex
  ) {
    return result(f, { decision: 'skip', reason: 'belongs to another author (multi-author fill arrives in V2)' });
  }

  const pf = prepareField(f);
  let cands = rankCandidates(f, pf);

  // "Name" next to first/last fields is not the full name.
  if (flags.hasSplitName) {
    cands = cands
      .map((c) => (c.key === 'personal.full_name' && c.signal !== 'autocomplete' ? { ...c, score: c.score - 0.4 } : c))
      .sort((a, b) => b.score - a.score);
  }

  const top = cands[0];
  const second = cands[1];
  const candidates = cands.slice(0, 3).map((c) => ({ key: c.key, score: round(c.score) }));
  if (!top || top.score < thresholds.ask) {
    return result(f, { decision: 'skip', reason: 'no confident match', candidates, confidence: round(top?.score ?? 0) });
  }

  let confidence = top.score;
  let reason = `${top.signal} match`;
  if (second && top.score - second.score < RULE_MARGIN) {
    confidence = Math.min(confidence, AMBIGUOUS_CAP);
    reason = `ambiguous between ${top.key} and ${second.key}`;
  } else if (top.signal !== 'autocomplete' && confidence < RULE_ACCEPT) {
    reason = `weak ${top.signal} match`;
  }

  const base = {
    key: top.key,
    confidence: round(confidence),
    layer: top.signal === 'autocomplete' ? ('autocomplete' as const) : ('rule' as const),
    candidates,
  };

  const def = getKeyDef(top.key);
  if (!def) return result(f, { ...base, decision: 'skip', reason: 'unknown key' });
  if (def.sensitive) return result(f, { ...base, decision: 'blocked', reason: 'sensitive profile key' });

  const verdict = validateFill(def, values[top.key], f);
  if (verdict.verdict === 'skip') {
    return result(f, { ...base, decision: 'skip', reason: verdict.reason ?? 'cannot fill' });
  }

  let decision: Decision = decideBand(confidence, thresholds);
  if (verdict.verdict === 'review') {
    decision = moreCautious(decision, 'review');
    reason = verdict.reason ?? reason;
  }
  if (decision === 'skip' || decision === 'ask' || verdict.fillValue === undefined) {
    return result(f, { ...base, decision, reason });
  }
  const preview = f.controlType === 'select' ? values[top.key]!.trim() : verdict.fillValue;
  return result(f, { ...base, decision, reason, value: verdict.fillValue, preview });
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function matchFields(fields: FieldInfo[], options: MatchOptions): MatchResult[] {
  const opts = { values: options.values, thresholds: options.thresholds ?? DEFAULT_SETTINGS.thresholds };
  const flags = formFlags(fields);
  return fields.map((f) => matchOne(f, opts, flags));
}
