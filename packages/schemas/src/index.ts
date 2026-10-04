import { z } from 'zod';

export const ThresholdsSchema = z.object({
  auto: z.number().min(0).max(1),
  review: z.number().min(0).max(1),
  ask: z.number().min(0).max(1),
});

export const SettingsSchema = z.object({
  thresholds: ThresholdsSchema,
  llm: z.object({
    enabled: z.boolean(),
    provider: z.enum(['proxy', 'ollama', 'off']),
    endpoint: z.string().optional(),
    /** Ollama model name. */
    model: z.string().optional(),
    /** Optional shared secret for your own proxy (never an Anthropic API key). */
    token: z.string().optional(),
  }),
  learning: z.object({ enabled: z.boolean() }),
  locked: z.boolean(),
});

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  values: z.record(z.string(), z.string()),
  updatedAt: z.number(),
});

export const SubmissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(
    z.object({
      profileId: z.string(),
      order: z.number().int(),
      corresponding: z.boolean(),
      role: z.string().optional(),
    }),
  ),
});

export const SiteMappingSchema = z.object({
  origin: z.string(),
  fieldSignature: z.string(),
  /** Human-readable label, so the management UI is meaningful. Never a value. */
  label: z.string().optional(),
  key: z.string(),
  source: z.enum(['user_correction', 'user_confirmed']),
  hits: z.number().int(),
  updatedAt: z.number(),
});

export const LlmResultSchema = z.object({
  field_id: z.string(),
  matched_profile_key: z.string().nullable(),
  confidence: z.number(),
  reason: z.string().max(300).optional(),
});

/** Response contract for the LLM fallback; anything else is discarded. */
export const LlmResponseSchema = z.object({ results: z.array(LlmResultSchema).max(50) });

export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type SiteMapping = z.infer<typeof SiteMappingSchema>;
export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export const DEFAULT_SETTINGS: Settings = {
  thresholds: { auto: 0.95, review: 0.8, ask: 0.5 },
  llm: { enabled: false, provider: 'off' },
  learning: { enabled: false },
  locked: false,
};

export function emptyProfile(): Profile {
  return { id: 'me', name: 'Me', values: {}, updatedAt: Date.now() };
}
