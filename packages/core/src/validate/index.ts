import type { FieldInfo, ProfileKeyDef } from '../types';
import { matchOption } from './options';

export { matchOption } from './options';
export { sensitiveReason } from './sensitive';

export interface Validation {
  /** `skip` = never write, `review` = a human must look, `ok` = no objection. */
  verdict: 'ok' | 'review' | 'skip';
  reason?: string;
  /** What to actually write (select → option value). */
  fillValue?: string;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validation gate (§7.8): runs for every result regardless of layer. */
export function validateFill(def: ProfileKeyDef, value: string | undefined, f: FieldInfo): Validation {
  const v = value?.trim();
  if (!v) return { verdict: 'skip', reason: 'no value in profile' };

  if (f.disabled || f.readOnly) return { verdict: 'skip', reason: 'field is disabled or read-only' };
  if (f.hidden) return { verdict: 'skip', reason: 'field is hidden' };
  if (f.hasValue) return { verdict: 'skip', reason: 'field already has a value' };

  // Boolean keys only make sense for checkboxes/radios, and vice versa.
  if (def.type === 'boolean' && f.controlType !== 'checkbox') {
    return { verdict: 'skip', reason: 'field is not a checkbox' };
  }

  switch (f.controlType) {
    case 'checkbox':
      if (def.type !== 'boolean') return { verdict: 'skip', reason: 'checkbox cannot hold this value' };
      // SmartFill only ever ticks a box; it never unticks one the page or the user set.
      if (v !== 'true') return { verdict: 'skip', reason: 'nothing to tick' };
      return { verdict: 'ok', fillValue: 'true' };
    case 'radio-group': {
      const idx = matchOption(v, f.options ?? []);
      if (idx < 0) return { verdict: 'review', reason: 'no matching radio option' };
      return { verdict: 'ok', fillValue: f.options![idx]!.value };
    }
    case 'custom':
      if (def.type === 'date') return { verdict: 'skip', reason: 'unsupported custom control' };
      // Options are unknown until the widget opens, so a human always confirms.
      return { verdict: 'review', reason: 'custom dropdown: options are checked when filling', fillValue: v };
    case 'textarea':
    case 'contenteditable':
      break;
    case 'input':
      if (!TEXT_INPUT_TYPES.has(f.inputType ?? '')) {
        return { verdict: 'skip', reason: `unsupported input type "${f.inputType}"` };
      }
      break;
    case 'select': {
      const idx = matchOption(v, f.options ?? []);
      if (idx < 0) return { verdict: 'review', reason: 'no matching option in dropdown' };
      return { verdict: 'ok', fillValue: f.options![idx]!.value };
    }
    default:
      return { verdict: 'skip', reason: `unsupported control (${f.controlType})` };
  }

  // input type vs key type
  const t = f.inputType;
  if (t === 'email' && def.type !== 'email') return { verdict: 'skip', reason: 'field expects an email address' };
  if (t === 'tel' && def.type !== 'tel') return { verdict: 'skip', reason: 'field expects a phone number' };
  if (t === 'url' && def.type !== 'url') return { verdict: 'skip', reason: 'field expects a URL' };
  if (def.type === 'email' && !EMAIL_RE.test(v)) return { verdict: 'review', reason: 'stored value is not a valid email' };

  if (f.maxLength !== undefined && f.maxLength >= 0 && v.length > f.maxLength) {
    return { verdict: 'review', reason: `value longer than maxlength ${f.maxLength}` };
  }
  if (f.pattern) {
    try {
      if (!new RegExp(`^(?:${f.pattern})$`, 'u').test(v)) return { verdict: 'review', reason: 'value does not match field pattern' };
    } catch {
      /* invalid page regex: ignore */
    }
  }
  return { verdict: 'ok', fillValue: v };
}
