import { distance } from 'fastest-levenshtein';
import { normalizeIdentifier, normalizeText, tokenize } from '../normalize';
import { REGISTRY } from '../registry/keys';
import type { FieldInfo, ProfileKeyDef } from '../types';

export interface Candidate {
  key: string;
  score: number;
  signal: 'autocomplete' | 'label-exact' | 'name-exact' | 'tokens' | 'fuzzy';
  /** Tokens of the synonym that matched; used to drop less specific keys. */
  matched: string[];
}

interface PreparedKey {
  def: ProfileKeyDef;
  synonyms: { text: string; tokens: string[] }[];
  negatives: Set<string>;
}

/** Words that mean the field is about someone/something other than the user. */
const CONTEXT_CONFLICTS = [
  'billing', 'emergency', 'guardian', 'parent', 'reviewer', 'referee', 'reference', 'spouse',
  'father', 'mother', 'friend', 'nominee', 'sponsor', 'payment', 'shipping', 'recipient',
];

let prepared: PreparedKey[] | null = null;
function getPrepared(): PreparedKey[] {
  prepared ??= REGISTRY.map((def) => {
    const texts = new Set([normalizeText(def.label), ...def.synonyms.map(normalizeText)]);
    texts.delete('');
    return {
      def,
      synonyms: [...texts].map((text) => ({ text, tokens: tokenize(text) })),
      negatives: new Set((def.negativeHints ?? []).map(normalizeText)),
    };
  });
  return prepared;
}

export interface PreparedField {
  /** Label-quality text sources (label, aria-label, nearby text when no label). */
  labels: string[];
  placeholder: string;
  name: string;
  id: string;
  autocompleteTokens: string[];
  section: string;
  allTokens: Set<string>;
}

export function prepareField(field: FieldInfo): PreparedField {
  const c = field.context;
  const labels = [normalizeText(c.label), normalizeText(c.ariaLabel)].filter(Boolean);
  if (labels.length === 0) {
    const nearby = normalizeText(c.nearbyText);
    if (nearby) labels.push(nearby);
  }
  const placeholder = normalizeText(c.placeholder);
  const name = normalizeIdentifier(c.name);
  const id = normalizeIdentifier(c.id);
  const section = normalizeText(c.sectionHeading);
  const autocompleteTokens = (c.autocomplete ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && t !== 'on' && t !== 'off' && !t.startsWith('section-'));
  const allTokens = new Set([...labels, placeholder, name, id].flatMap(tokenize));
  return { labels, placeholder, name, id, autocompleteTokens, section, allTokens };
}

function tokensPresent(synTokens: string[], textTokens: string[]): boolean {
  return synTokens.every((t) => textTokens.includes(t));
}

function tokensFuzzy(synTokens: string[], textTokens: string[]): boolean {
  let fuzzy = false;
  for (const st of synTokens) {
    if (textTokens.includes(st)) continue;
    const hit = st.length >= 5 && textTokens.some((tt) => tt.length >= 5 && distance(st, tt) <= 1);
    if (!hit) return false;
    fuzzy = true;
  }
  return fuzzy;
}

function scoreKey(p: PreparedKey, f: FieldInfo, pf: PreparedField): Candidate | null {
  const { def } = p;
  let best: Candidate | null = null;
  const offer = (c: Omit<Candidate, 'key'>) => {
    if (!best || c.score > best.score) best = { key: def.key, ...c };
  };

  // 1. autocomplete attribute
  if (def.autocomplete?.some((a) => pf.autocompleteTokens.includes(a))) {
    offer({ score: 0.99, signal: 'autocomplete', matched: [] });
  }

  for (const syn of p.synonyms) {
    // 2. exact synonym on label / placeholder / name / id
    for (const label of pf.labels) {
      if (label === syn.text) offer({ score: 0.97, signal: 'label-exact', matched: syn.tokens });
    }
    if (pf.placeholder === syn.text) offer({ score: 0.94, signal: 'label-exact', matched: syn.tokens });
    if (pf.name === syn.text || pf.id === syn.text) offer({ score: 0.93, signal: 'name-exact', matched: syn.tokens });

    // 3. all synonym tokens present
    for (const label of pf.labels) {
      const lt = tokenize(label);
      if (tokensPresent(syn.tokens, lt)) {
        const extra = lt.length - syn.tokens.length;
        offer({ score: extra > 2 ? 0.85 : 0.9, signal: 'tokens', matched: syn.tokens });
      } else if (tokensFuzzy(syn.tokens, lt)) {
        offer({ score: 0.8, signal: 'fuzzy', matched: syn.tokens });
      }
    }
    const pt = tokenize(pf.placeholder);
    if (pt.length && tokensPresent(syn.tokens, pt)) {
      offer({ score: pt.length - syn.tokens.length > 2 ? 0.82 : 0.87, signal: 'tokens', matched: syn.tokens });
    }
    for (const attr of [pf.name, pf.id]) {
      const at = tokenize(attr);
      if (at.length && tokensPresent(syn.tokens, at)) offer({ score: 0.85, signal: 'tokens', matched: syn.tokens });
    }
  }

  const found = best as Candidate | null;
  if (!found) return null;
  let score = found.score;

  // type=email input and an email-ish key with a real signal → very strong
  if (def.type === 'email' && f.inputType === 'email' && score >= 0.9) score = 0.99;

  // negative hints (not applied to autocomplete: the page says it explicitly)
  if (found.signal !== 'autocomplete' && [...p.negatives].some((n) => pf.allTokens.has(n))) score -= 0.3;

  return { ...found, score: Math.max(0, Math.min(1, score)) };
}

export function sectionConflict(pf: PreparedField): boolean {
  const hay = new Set([...tokenize(pf.section), ...pf.allTokens]);
  return CONTEXT_CONFLICTS.some((w) => hay.has(w));
}

/** Rank registry keys for one field. Highest score first. */
export function rankCandidates(f: FieldInfo, pf: PreparedField = prepareField(f)): Candidate[] {
  const conflict = sectionConflict(pf);
  let cands: Candidate[] = [];
  for (const p of getPrepared()) {
    const c = scoreKey(p, f, pf);
    if (!c) continue;
    cands.push(conflict ? { ...c, score: Math.max(0, c.score - 0.4) } : c);
  }

  // A key whose matched synonym is a strict subset of another candidate's
  // matched synonym is less specific ("name" vs "last name") → drop it.
  cands = cands.filter(
    (a) =>
      !cands.some(
        (b) =>
          b !== a &&
          b.score >= a.score &&
          a.matched.length > 0 &&
          b.matched.length > a.matched.length &&
          a.matched.every((t) => b.matched.includes(t)),
      ),
  );

  return cands.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
}
