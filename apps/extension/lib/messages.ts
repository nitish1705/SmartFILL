import type { Decision } from '@smartfill/core';

export type Command = 'smartfill:scan' | 'smartfill:fill' | 'smartfill:undo';

/** Popup → background. */
export interface CommandMessage {
  type: Command;
  tabId: number;
}

export interface Row {
  fieldId: string;
  label: string;
  key: string | null;
  keyLabel?: string;
  confidence: number;
  decision: Decision;
  reason: string;
  preview?: string;
}

export interface Counts {
  detected: number;
  safe: number;
  review: number;
  ask: number;
  unavailable: number;
  blocked: number;
}

export type Response =
  | { ok: true; rows: Row[]; counts: Counts; filled?: number; undone?: number }
  | { ok: false; error: string };
