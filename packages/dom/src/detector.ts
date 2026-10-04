import type { ControlType, FieldContext, FieldInfo, SelectOption } from '@smartfill/core';

export interface DetectedField extends FieldInfo {
  /** The control to act on (for radio groups: the first radio). */
  element: HTMLElement;
  /** Radio groups: one element per entry of `options`. */
  elements?: HTMLElement[];
}

export const CONTROL_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"]';
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend';
const PLACEHOLDER_OPTION = /^\s*(?:select|choose|pick|please|--|—|-)/i;
const MAX_NEARBY = 60;
/** Radios whose own label says this are treated as individual boolean fields, not a group. */
const BOOLEAN_RADIO = /correspond/i;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Collect controls from the document and any open shadow roots. */
export function collectControls(root: Document | ShadowRoot | Element, out: HTMLElement[] = []): HTMLElement[] {
  root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach((el) => out.push(el));
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.shadowRoot) collectControls(el.shadowRoot, out);
  });
  return out;
}

function isHidden(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(el).visibility === 'hidden') return true;
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    if (e.hidden || view.getComputedStyle(e).display === 'none') return true;
  }
  return false;
}

/** Text of a node without the text of any form controls nested inside it. */
function textWithoutControls(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('input, select, textarea, option, script, style, button').forEach((n) => n.remove());
  return clean(copy.textContent);
}

function labelText(el: HTMLElement): string | undefined {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    return clean([...labels].map(textWithoutControls).join(' ')) || undefined;
  }
  return undefined;
}

function idsText(el: HTMLElement, attr: string): string | undefined {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean);
  if (!ids?.length) return undefined;
  const root = el.getRootNode() as Document | ShadowRoot;
  const text = ids.map((id) => clean(root.getElementById?.(id)?.textContent)).filter(Boolean).join(' ');
  return text || undefined;
}

function controlCount(node: Element): number {
  return node.querySelectorAll(CONTROL_SELECTOR).length;
}

/** Visible text right before the control, e.g. a table cell or div that acts as its label. */
function precedingText(el: HTMLElement): string | undefined {
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 3 && node; depth++) {
    for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
      let text = '';
      if (sib.nodeType === 3) text = clean(sib.textContent);
      else if (sib.nodeType === 1) {
        const se = sib as Element;
        if (controlCount(se) > 0 || se.matches(CONTROL_SELECTOR)) break;
        text = textWithoutControls(se);
      }
      if (text) return text.length > MAX_NEARBY ? undefined : text;
    }
    const parent: HTMLElement | null = node.parentElement;
    if (!parent || /^(form|body|fieldset|html)$/i.test(parent.tagName) || controlCount(parent) > 1) break;
    node = parent;
  }
  return undefined;
}

function headingsOf(root: Node, headingsByRoot: Map<Node, Element[]>): Element[] {
  let headings = headingsByRoot.get(root);
  if (!headings) {
    headings = [...(root as Document).querySelectorAll(HEADING_SELECTOR)];
    headingsByRoot.set(root, headings);
  }
  return headings;
}

function sectionHeadingEl(el: HTMLElement, headingsByRoot: Map<Node, Element[]>): Element | undefined {
  const root = el.getRootNode();
  const headings = headingsOf(root, headingsByRoot);
  const legend = el.closest('fieldset')?.querySelector(':scope > legend');
  if (legend) return legend;
  let found: Element | undefined;
  for (const h of headings) {
    if (h.compareDocumentPosition(el) & 4 /* FOLLOWING */) found = h;
    else break;
  }
  return found;
}

/** `author[2][email]`, `authors.2.email`, "Author 3" → 2/3. Unnumbered "Author" blocks → their ordinal. */
function authorIndex(
  name: string,
  id: string,
  heading: Element | undefined,
  headingsByRoot: Map<Node, Element[]>,
): number | undefined {
  const text = clean(heading?.textContent);
  const m = /author\D{0,3}(\d+)/i.exec(name) ?? /author\D{0,3}(\d+)/i.exec(id) ?? /author\s*(\d+)/i.exec(text);
  if (m) return Number(m[1]);
  // "Add Author" blocks often repeat an unnumbered "Author" heading: number them by position.
  if (heading && /^author\b/i.test(text) && !/\d/.test(text)) {
    const same = headingsOf(heading.getRootNode(), headingsByRoot).filter((h) => /^author\b/i.test(clean(h.textContent)) && !/\d/.test(h.textContent ?? ''));
    const n = same.indexOf(heading);
    return n >= 0 ? n + 1 : undefined;
  }
  return undefined;
}

function selectHasValue(sel: HTMLSelectElement): boolean {
  if (sel.multiple) return [...sel.selectedOptions].some((o) => o.value !== '');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || opt.value === '' || PLACEHOLDER_OPTION.test(opt.text)) return false;
  return sel.selectedIndex > 0 || opt.hasAttribute('selected');
}

function groupLabel(first: HTMLElement): string | undefined {
  const legend = first.closest('fieldset')?.querySelector(':scope > legend');
  if (legend) return clean(legend.textContent) || undefined;
  const group = first.closest('[role="radiogroup"]');
  if (group) return group.getAttribute('aria-label') ?? idsText(group as HTMLElement, 'aria-labelledby');
  return precedingText((first.closest('label') as HTMLElement | null) ?? first);
}

export function detectFields(doc: Document): DetectedField[] {
  const headingsByRoot = new Map<Node, Element[]>();
  const fields: DetectedField[] = [];
  const all = collectControls(doc);
  const handledRadios = new Set<HTMLElement>();

  for (const el of all) {
    if (handledRadios.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    let controlType: ControlType = 'contenteditable';
    let inputType: string | undefined;
    let radioGroup: HTMLInputElement[] | null = null;

    if (role === 'combobox' && tag !== 'select') {
      // wrapper divs around a real control are skipped; the inner control is the one we act on
      if (el.querySelector(CONTROL_SELECTOR)) continue;
      controlType = 'custom';
    } else if (tag === 'input') {
      inputType = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (SKIPPED_INPUT_TYPES.has(inputType)) continue;
      if (inputType === 'checkbox') controlType = 'checkbox';
      else if (inputType === 'radio') {
        const radio = el as HTMLInputElement;
        const own = labelText(radio) ?? '';
        if (BOOLEAN_RADIO.test(own)) controlType = 'checkbox';
        else if (radio.name) {
          const root = radio.getRootNode() as Document | ShadowRoot;
          radioGroup = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
            (r) => r.name === radio.name && r.form === radio.form,
          );
          radioGroup.forEach((r) => handledRadios.add(r));
          controlType = 'radio-group';
        } else controlType = 'radio-group';
      } else controlType = 'input';
    } else if (tag === 'textarea') controlType = 'textarea';
    else if (tag === 'select') controlType = 'select';

    const name = el.getAttribute('name') ?? '';
    const id = el.id ?? '';
    const headingEl = sectionHeadingEl(el, headingsByRoot);
    const heading = headingEl ? clean(headingEl.textContent).slice(0, 80) || undefined : undefined;
    const label =
      controlType === 'radio-group' ? groupLabel(radioGroup?.[0] ?? el) : labelText(el);
    const context: FieldContext = {
      label,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      name: name || undefined,
      id: id || undefined,
      ariaLabel: el.getAttribute('aria-label') ?? idsText(el, 'aria-labelledby'),
      ariaDescribedBy: idsText(el, 'aria-describedby'),
      autocomplete: el.getAttribute('autocomplete') ?? undefined,
      nearbyText: label ? undefined : precedingText(el),
      sectionHeading: heading,
      pageTitle: doc.title,
      authorIndex: authorIndex(name, id, headingEl, headingsByRoot),
    };

    let options: SelectOption[] | undefined;
    let elements: HTMLElement[] | undefined;
    let hasValue = false;
    if (controlType === 'select') {
      const sel = el as HTMLSelectElement;
      options = [...sel.options].map((o) => ({ text: clean(o.text), value: o.value }));
      hasValue = selectHasValue(sel);
    } else if (controlType === 'radio-group') {
      const group = radioGroup ?? [el as HTMLInputElement];
      elements = group;
      options = group.map((r) => ({ text: labelText(r) ?? clean(r.value), value: r.value }));
      hasValue = group.some((r) => r.checked);
    } else if (controlType === 'custom') {
      const input = el as HTMLInputElement;
      hasValue = clean(tag === 'input' ? input.value : el.textContent) !== '' && !/^(select|choose)/i.test(clean(el.textContent));
    } else if (controlType === 'contenteditable') hasValue = clean(el.textContent) !== '';
    else if (controlType === 'input' || controlType === 'textarea') {
      hasValue = (el as HTMLInputElement).value.trim() !== '';
    } else if ((el as HTMLInputElement).type === 'radio') {
      // single radio treated as a boolean: it cannot be ticked if another radio of its group already is
      const r = el as HTMLInputElement;
      const root = r.getRootNode() as Document | ShadowRoot;
      hasValue = r.checked || (!!r.name && [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((o) => o.name === r.name && o.form === r.form && o.checked));
    } else hasValue = (el as HTMLInputElement).checked;

    const maxLength = (el as HTMLInputElement).maxLength;
    fields.push({
      fieldId: `f${fields.length}`,
      element: el,
      elements,
      controlType,
      inputType,
      maxLength: typeof maxLength === 'number' && maxLength >= 0 ? maxLength : undefined,
      pattern: el.getAttribute('pattern') ?? undefined,
      disabled: (el as HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
      readOnly: (el as HTMLInputElement).readOnly === true || el.getAttribute('aria-readonly') === 'true',
      hidden: isHidden(el),
      hasValue,
      options,
      context,
    });
  }
  return fields;
}

/**
 * Watch for controls added after load ("Add Author" buttons, wizards). `onChange` is debounced and only
 * fires when added nodes are or contain form controls.
 */
export function watchForNewFields(doc: Document, onChange: () => void, delayMs = 300): () => void {
  const View = doc.defaultView;
  if (!View || !doc.body) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new View.MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      [...m.addedNodes].some((n) => n.nodeType === 1 && ((n as Element).matches(CONTROL_SELECTOR) || controlCount(n as Element) > 0)),
    );
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
