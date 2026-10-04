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

export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

export const DEFAULT_SETTINGS: Settings = {
  thresholds: { auto: 0.95, review: 0.8, ask: 0.5 },
  llm: { enabled: false, provider: 'off' },
  learning: { enabled: false },
  locked: false,
};

export function emptyProfile(): Profile {
  return { id: 'me', name: 'Me', values: {}, updatedAt: Date.now() };
}
