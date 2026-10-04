import { REGISTRY, checkFill, getKeyDef, type MatchResult, type ProfileValues } from '@smartfill/core';
import type { Analysis, DetectedField, HighlightKind } from '@smartfill/dom';

declare const __E2E__: boolean;

export const IGNORE = 'IGNORE';

export interface FillItem {
  field: DetectedField;
  key: string;
  value: string;
  kind: HighlightKind;
}

export interface OverlayDeps {
  analysis: Analysis;
  /** Profile values that apply to each field, parallel to `analysis.fields` (author blocks differ). */
  fieldValues: ProfileValues[];
  onFill(items: FillItem[]): Promise<number>;
  onUndo(): Promise<number>;
  /** User chose a key (or IGNORE) different from the suggestion. */
  onCorrection?(field: DetectedField, key: string): void;
  /** User kept a suggestion that was not certain. */
  onConfirm?(field: DetectedField, key: string): void;
  onClose?(): void;
}

export interface OverlayHandle {
  close(): void;
  /** Fields appeared or changed (e.g. "Add author"): merge them in, keeping the user's choices. */
  update(analysis: Analysis, fieldValues: ProfileValues[]): void;
}

interface RowState {
  field: DetectedField;
  result: MatchResult;
  values: ProfileValues;
  key: string;
  include: boolean;
  value?: string;
  preview?: string;
  note: string;
  done: boolean;
}

const CSS = `
:host { all: initial; }
.panel { position: fixed; top: 12px; right: 12px; width: 400px; max-height: calc(100vh - 24px); display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
  font: 13px/1.4 system-ui, sans-serif; z-index: 2147483647; }
:host { --bg:#fff; --fg:#1f2328; --muted:#59636e; --line:#d0d7de; --accent:#0b5bd3; --ok:#116329; --warn:#8a4b08; --chip:#eef0f2; }
@media (prefers-color-scheme: dark) { :host { --bg:#14171a; --fg:#e6edf3; --muted:#9ba4ae; --line:#30363d; --accent:#6ea8fe; --ok:#56d364; --warn:#f0a35a; --chip:#21262d; } }
header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid var(--line); }
h2 { font-size:14px; margin:0; }
.list { overflow:auto; padding:6px 0; }
.row { display:grid; grid-template-columns:20px 1fr; gap:8px; padding:8px 12px; border-bottom:1px solid var(--line); }
.row:last-child { border-bottom:0; }
.row.done { opacity:.6; }
.label { font-weight:600; overflow-wrap:anywhere; }
.badge { font-size:11px; padding:1px 6px; border-radius:999px; background:var(--chip); margin-left:6px; font-weight:400; }
.badge.auto { color:var(--ok); } .badge.review, .badge.ask { color:var(--warn); }
.value { font-family:ui-monospace,Consolas,monospace; font-size:12px; overflow-wrap:anywhere; margin-top:2px; }
.note { color:var(--muted); font-size:12px; }
select { width:100%; margin-top:4px; font:inherit; padding:3px; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:6px; }
footer { display:flex; gap:8px; align-items:center; padding:10px 12px; border-top:1px solid var(--line); }
button { font:inherit; cursor:pointer; padding:5px 10px; border-radius:6px; border:1px solid var(--line); background:var(--chip); color:var(--fg); }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible, select:focus-visible, input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.grow { flex:1; color:var(--muted); }
.muted { color:var(--muted); padding:8px 12px; font-size:12px; }
`;

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  }
  // textContent only: page-derived strings must never be interpreted as HTML
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

let current: OverlayHandle | null = null;

function buildRows(a: Analysis, fieldValues: ProfileValues[], old: Map<HTMLElement, RowState>): RowState[] {
  return a.fields.flatMap((field, i) => {
    const result = a.results[i]!;
    const kept = old.get(field.element);
    if (kept) return [{ ...kept, field, result: kept.done ? kept.result : result, values: fieldValues[i] ?? {} }];
    if (!['auto', 'review', 'ask'].includes(result.decision) || !result.key) return [];
    return [{
      field, result, values: fieldValues[i] ?? {}, key: result.key,
      include: result.decision !== 'ask' && result.value !== undefined,
      value: result.value, preview: result.preview, note: result.reason, done: false,
    }];
  });
}

export function openOverlay(deps: OverlayDeps): OverlayHandle {
  current?.close();

  let analysis = deps.analysis;
  let rows = buildRows(analysis, deps.fieldValues, new Map());
  const stats = () => ({
    notInProfile: analysis.results
      .filter((r) => r.decision === 'skip' && r.key && r.reason === 'no value in profile')
      .map((r) => getKeyDef(r.key!)?.label ?? r.key!),
    protectedCount: analysis.results.filter((r) => r.decision === 'blocked').length,
  });

  const host = h('div', { id: 'smartfill-overlay' });
  const root = host.attachShadow({ mode: __E2E__ ? 'open' : 'closed' });
  const status = h('span', { class: 'grow', role: 'status', 'aria-live': 'polite' });
  const fillBtn = h('button', { class: 'primary' }, 'Fill selected');
  const undoBtn = h('button', {}, 'Undo');
  const closeBtn = h('button', { 'aria-label': 'Close SmartFill review' }, '✕');
  const list = h('div', { class: 'list' });

  const refreshCount = () => {
    const n = rows.filter((r) => r.include && r.value !== undefined && !r.done).length;
    fillBtn.textContent = `Fill selected (${n})`;
    (fillBtn as HTMLButtonElement).disabled = n === 0;
  };

  const flash = (el: HTMLElement) => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = el.style.outline;
    el.style.outline = '2px solid #2563eb';
    setTimeout(() => (el.style.outline = prev), 1200);
  };

  const keyOptions = (row: RowState): HTMLSelectElement => {
    const sel = h('select', { 'aria-label': `Profile field for ${row.field.context.label ?? 'this field'}` });
    const add = (parent: Node, value: string, text: string) => {
      const o = h('option', { value }, text);
      if (value === row.key) o.selected = true;
      parent.appendChild(o);
    };
    add(sel, '', "— don't fill —");
    const suggested = new Set(row.result.candidates.map((c) => c.key));
    const g1 = h('optgroup', { label: 'Suggested' });
    for (const c of row.result.candidates) add(g1, c.key, getKeyDef(c.key)?.label ?? c.key);
    if (g1.children.length) sel.appendChild(g1);
    const g2 = h('optgroup', { label: 'Your profile' });
    for (const d of REGISTRY) {
      if (!d.sensitive && row.values[d.key] && !suggested.has(d.key)) add(g2, d.key, d.label);
    }
    if (g2.children.length) sel.appendChild(g2);
    add(sel, IGNORE, 'Never fill this field on this site');
    return sel;
  };

  const render = () => {
    list.replaceChildren();
    if (rows.length === 0) list.append(h('div', { class: 'muted' }, 'Nothing here can be filled from your profile.'));
    for (const row of rows) {
      const name = row.field.context.label ?? row.field.context.ariaLabel ?? row.field.context.placeholder ?? row.field.context.name ?? 'Field';
      const author = row.field.context.authorIndex !== undefined ? ` (author ${row.field.context.authorIndex})` : '';
      const cb = h('input', { type: 'checkbox', 'aria-label': `Include ${name}` }) as HTMLInputElement;
      cb.checked = row.include && !row.done;
      cb.disabled = row.value === undefined || row.done;
      cb.addEventListener('change', () => {
        row.include = cb.checked;
        refreshCount();
      });
      const sel = keyOptions(row);
      sel.disabled = row.done;
      sel.addEventListener('change', () => {
        const key = sel.value;
        row.key = key;
        if (key === '' || key === IGNORE) {
          Object.assign(row, { include: false, value: undefined, preview: undefined, note: key === IGNORE ? 'will be remembered for this site' : 'left blank' });
          if (key === IGNORE) deps.onCorrection?.(row.field, IGNORE);
        } else {
          const check = checkFill(row.field, key, row.values);
          Object.assign(row, {
            include: check.ok, value: check.value, preview: check.preview,
            note: check.ok ? check.reason ?? 'chosen by you' : check.reason ?? 'cannot fill this field with that value',
          });
          if (key !== row.result.key) deps.onCorrection?.(row.field, key);
        }
        render();
      });
      const el = h('div', { class: `row${row.done ? ' done' : ''}` },
        cb,
        h('div', {},
          h('div', { class: 'label' }, name + author,
            h('span', { class: `badge ${row.result.decision}` }, row.result.decision === 'auto' ? 'safe' : row.result.decision === 'review' ? 'review' : 'unsure')),
          sel,
          h('div', { class: 'value' }, row.preview ?? ''),
          h('div', { class: 'note' }, row.done ? 'Filled' : row.note)),
      );
      el.addEventListener('mouseenter', () => flash(row.field.element));
      list.append(el);
    }
    const { notInProfile, protectedCount } = stats();
    const extra: string[] = [];
    if (notInProfile.length) extra.push(`Not in your profile: ${[...new Set(notInProfile)].join(', ')}.`);
    if (protectedCount) extra.push(`${protectedCount} protected field${protectedCount === 1 ? '' : 's'} (passwords, cards, IDs) left alone.`);
    if (extra.length) list.append(h('div', { class: 'muted' }, extra.join(' ')));
    refreshCount();
  };

  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onKey, true);
    if (current === handle) current = null;
    deps.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  fillBtn.addEventListener('click', async () => {
    const todo = rows.filter((r) => r.include && r.value !== undefined && !r.done);
    const items: FillItem[] = todo.map((r) => ({
      field: r.field, key: r.key, value: r.value!,
      kind: r.result.decision === 'auto' && r.key === r.result.key ? 'auto' : 'review',
    }));
    const n = await deps.onFill(items);
    for (const r of todo) {
      r.done = true;
      if (r.result.decision !== 'auto' && r.key === r.result.key) deps.onConfirm?.(r.field, r.key);
    }
    status.textContent = `Filled ${n} field${n === 1 ? '' : 's'}${n < todo.length ? ` (${todo.length - n} could not be filled)` : ''}.`;
    render();
  });
  undoBtn.addEventListener('click', async () => {
    const n = await deps.onUndo();
    for (const r of rows) r.done = false;
    status.textContent = `Restored ${n} field${n === 1 ? '' : 's'}.`;
    render();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  const handle: OverlayHandle = {
    close,
    update(next, fieldValues) {
      const before = rows.length;
      analysis = next;
      rows = buildRows(next, fieldValues, new Map(rows.map((r) => [r.field.element, r])));
      status.textContent = rows.length > before ? `${rows.length - before} new field${rows.length - before === 1 ? '' : 's'} found.` : status.textContent;
      render();
    },
  };

  root.append(
    h('style', {}, CSS),
    h('div', { class: 'panel', role: 'dialog', 'aria-label': 'SmartFill review' },
      h('header', {}, h('h2', {}, 'SmartFill review'), closeBtn),
      list,
      h('footer', {}, fillBtn, undoBtn, status)),
  );
  document.documentElement.append(host);
  render();
  (fillBtn as HTMLButtonElement).focus();

  current = handle;
  return handle;
}
