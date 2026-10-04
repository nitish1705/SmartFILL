export * from './types';
export { REGISTRY, getKeyDef } from './registry/keys';
export { normalizeText, normalizeIdentifier, splitIdentifier, tokenize } from './normalize';
export { matchFields } from './match';
export type { MatchOptions } from './match';
export { rankCandidates, prepareField } from './match/rules';
export { validateFill, matchOption, sensitiveReason } from './validate';
export { decideBand, moreCautious } from './decide';
