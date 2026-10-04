/**
 * Autofill engine. Hard rule: this module writes values and dispatches
 * input/change/blur events. It never clicks, submits, or presses Enter.
 */

export interface FillRecord {
  element: HTMLElement;
  previous: string;
}

export type HighlightKind = 'auto' | 'review';

const COLORS: Record<HighlightKind, string> = { auto: '#16a34a', review: '#d97706' };

function win(el: HTMLElement): Window & typeof globalThis {
  return (el.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
}

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

/** Write `value` into `el`. Returns a record for undo. */
export function fillField(el: HTMLElement, value: string, kind: HighlightKind = 'auto'): FillRecord {
  const record: FillRecord = { element: el, previous: currentValue(el) };
  writeValue(el, value);
  highlight(el, kind);
  return record;
}

export function undoFill(records: FillRecord[]): number {
  let n = 0;
  for (const r of [...records].reverse()) {
    if (!r.element.isConnected) continue;
    writeValue(r.element, r.previous);
    n++;
  }
  return n;
}
