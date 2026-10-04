/**
 * Autofill engine. Hard rule: this module writes values and dispatches input/change/blur events.
 * The only clicks it ever makes are on checkbox/radio inputs and on dropdown *options* the user approved;
 * it never clicks buttons, submits, or presses Enter.
 */
import { matchOption } from '@smartfill/core';
import type { DetectedField } from './detector';

export interface FillRecord {
  element: HTMLElement;
  previous: string;
  /** Custom undo (checkbox, radio, custom dropdown). */
  restore?: () => void;
}

export type HighlightKind = 'auto' | 'review';

const COLORS: Record<HighlightKind, string> = { auto: '#16a34a', review: '#d97706' };

function win(el: HTMLElement): Window & typeof globalThis {
  return (el.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
}

const sleep = (el: HTMLElement, ms: number) => new Promise<void>((r) => win(el).setTimeout(r, ms));

/** Bypass React/Vue value trackers by calling the prototype's native setter. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function fireEvents(el: HTMLElement): void {
  const W = win(el);
  el.dispatchEvent(new W.Event('input', { bubbles: true }));
  el.dispatchEvent(new W.Event('change', { bubbles: true }));
  el.dispatchEvent(new W.Event('blur', { bubbles: true }));
}

function currentValue(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return (el as HTMLInputElement).value;
  return el.textContent ?? '';
}

function writeValue(el: HTMLElement, value: string): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    setNativeValue(el as HTMLInputElement, value);
    fireEvents(el);
    return;
  }
  // contenteditable
  const doc = el.ownerDocument;
  el.focus();
  let ok = false;
  try {
    doc.execCommand('selectAll', false);
    ok = doc.execCommand('insertText', false, value);
  } catch {
    ok = false;
  }
  if (!ok || el.textContent !== value) {
    el.textContent = value;
    el.dispatchEvent(new (win(el).Event)('input', { bubbles: true }));
  }
  el.dispatchEvent(new (win(el).Event)('change', { bubbles: true }));
}

function highlight(el: HTMLElement, kind: HighlightKind): void {
  const prev = { outline: el.style.outline, offset: el.style.outlineOffset };
  el.style.outline = `2px solid ${COLORS[kind]}`;
  el.style.outlineOffset = '1px';
  win(el).setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.offset;
  }, 2500);
}

/** Write `value` into a text-like control or native select. Returns a record for undo. */
export function fillField(el: HTMLElement, value: string, kind: HighlightKind = 'auto'): FillRecord {
  const record: FillRecord = { element: el, previous: currentValue(el) };
  writeValue(el, value);
  highlight(el, kind);
  return record;
}

// ── checkbox / radio ────────────────────────────────────────────────────────────

/** Tick a checkbox/radio. A real click is the only reliable way to notify React/Vue/Angular. */
function tick(el: HTMLInputElement, kind: HighlightKind): FillRecord {
  const before = el.checked;
  if (!before) el.click();
  highlight(el, kind);
  return {
    element: el,
    previous: String(before),
    restore: () => {
      if (el.type === 'checkbox' && el.checked !== before) el.click();
      else if (el.type === 'radio' && !before) {
        el.checked = false;
        el.dispatchEvent(new (win(el).Event)('change', { bubbles: true }));
      }
    },
  };
}

function fillRadioGroup(field: DetectedField, value: string, kind: HighlightKind): FillRecord | null {
  const radios = (field.elements ?? [field.element]) as HTMLInputElement[];
  const target = radios.find((r) => r.value === value);
  if (!target) return null;
  const previouslyChecked = radios.find((r) => r.checked);
  const record = tick(target, kind);
  record.restore = () => {
    if (previouslyChecked) previouslyChecked.click();
    else {
      target.checked = false;
      target.dispatchEvent(new (win(target).Event)('change', { bubbles: true }));
    }
  };
  return record;
}

// ── custom dropdowns (ARIA combobox: react-select, MUI, Select2 popups, …) ─────────

function visibleOptions(el: HTMLElement): HTMLElement[] {
  const root = el.getRootNode() as Document | ShadowRoot;
  const doc = el.ownerDocument;
  const scoped: HTMLElement[] = [];
  for (const attr of ['aria-controls', 'aria-owns']) {
    for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
      root.getElementById?.(id)?.querySelectorAll<HTMLElement>('[role="option"]').forEach((o) => scoped.push(o));
    }
  }
  const found = scoped.length
    ? scoped
    : [...doc.querySelectorAll<HTMLElement>('[role="option"], .select2-results__option')];
  return found.filter((o) => (o.textContent ?? '').trim() !== '');
}

async function fillCustomDropdown(el: HTMLElement, value: string, kind: HighlightKind): Promise<FillRecord | null> {
  const W = win(el);
  const mouse = (target: HTMLElement, type: string) =>
    target.dispatchEvent(new W.MouseEvent(type, { bubbles: true, cancelable: true }));
  const isInput = el.tagName.toLowerCase() === 'input';
  const previous = currentValue(el);

  el.focus();
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) mouse(el, t);
  if (isInput) {
    // typing narrows virtualised/async option lists
    setNativeValue(el as HTMLInputElement, value.slice(0, 40));
    el.dispatchEvent(new W.Event('input', { bubbles: true }));
  }

  let options: HTMLElement[] = [];
  for (let waited = 0; waited < 1500; waited += 60) {
    options = visibleOptions(el);
    if (options.length) break;
    await sleep(el, 60);
  }
  const texts = options.map((o) => (o.textContent ?? '').trim());
  const idx = options.length ? matchOption(value, texts.map((text) => ({ text, value: text }))) : -1;

  const cancel = () => {
    if (isInput) {
      setNativeValue(el as HTMLInputElement, previous);
      el.dispatchEvent(new W.Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };
  if (idx < 0) {
    cancel();
    return null;
  }

  const chosen = options[idx]!;
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) mouse(chosen, t);
  await sleep(el, 100);

  // verify: the widget should now show the chosen text somewhere near the control
  const want = texts[idx]!.toLowerCase();
  let shown = false;
  for (let n: HTMLElement | null = el, d = 0; n && d < 5 && !shown; n = n.parentElement, d++) {
    shown = (n.textContent ?? '').toLowerCase().includes(want) || (n as HTMLInputElement).value?.toLowerCase?.() === want;
  }
  if (!shown) {
    cancel();
    return null;
  }
  highlight(el, kind);
  return { element: el, previous, restore: isInput ? () => writeValue(el, previous) : undefined };
}

/** Fill one detected field according to its control type. Returns null when nothing could be written. */
export async function fillDetected(field: DetectedField, value: string, kind: HighlightKind = 'auto'): Promise<FillRecord | null> {
  switch (field.controlType) {
    case 'checkbox':
      return value === 'true' ? tick(field.element as HTMLInputElement, kind) : null;
    case 'radio-group':
      return fillRadioGroup(field, value, kind);
    case 'custom':
      return fillCustomDropdown(field.element, value, kind);
    default:
      return fillField(field.element, value, kind);
  }
}

export function undoFill(records: FillRecord[]): number {
  let n = 0;
  for (const r of [...records].reverse()) {
    if (!r.element.isConnected) continue;
    if (r.restore) r.restore();
    else writeValue(r.element, r.previous);
    n++;
  }
  return n;
}
