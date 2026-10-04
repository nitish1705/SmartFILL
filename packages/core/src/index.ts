export * from './types';
export { REGISTRY, getKeyDef } from './registry/keys';
export { normalizeText, normalizeIdentifier, splitIdentifier, tokenize } from './normalize';
export { matchFields } from './match';
export type { MatchOptions, AuthorSource } from './match';
export { fieldSignature } from './site';
export * from './crypto/vault';
export { rankCandidates, prepareField } from './match/rules';
export { validateFill, matchOption, sensitiveReason } from './validate';
export { decideBand, moreCautious } from './decide';
export { matchFieldsAsync, checkFill, escalationCandidates, resolveFieldValues } from './match';
export type { MatchServices, ExtraSignals, FillCheck } from './match';
export {
  createEmbeddingIndex, embeddingAccepted, fieldText, keyAnchors, calibrate, cosine,
  DEFAULT_CALIBRATION, EMBEDDING_ACCEPT, EMBEDDING_MARGIN, EMBEDDING_CAP,
} from './embedding';
export type { Embedder, EmbeddingCandidate, EmbeddingIndex, Calibration } from './embedding';
export {
  LLM_SYSTEM_PROMPT, LLM_BATCH_SIZE, LLM_CONFIDENCE_CAP, LLM_TIMEOUT_MS,
  buildLlmRequest, llmCandidateKeys, parseLlmResponse,
} from './llm';
export type { LlmRequest, LlmFieldRequest, LlmPick } from './llm';
export { extractFromCv } from './import/cv';
export type { CvSuggestion } from './import/cv';
