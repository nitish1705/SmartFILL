import type { ControlType, FieldContext, FieldInfo, SelectOption } from '@smartfill/core';

export interface DetectedField extends FieldInfo {
  element: HTMLElement;
}

const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend';
const PLACEHOLDER_OPTION = /^\s*(?:select|choose|pick|please|--|—|-)/i;
const MAX_NEARBY = 60;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Collect controls from the document and any open shadow roots. */
function collectControls(root: Document | ShadowRoot | Element, out: HTMLElement[] = []): HTMLElement[] {
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

function sectionHeading(el: HTMLElement, headingsByRoot: Map<Node, Element[]>): string | undefined {
  const legend = el.closest('fieldset')?.querySelector(':scope > legend');
  if (legend) return clean(legend.textContent).slice(0, 80) || undefined;
  const root = el.getRootNode();
  let headings = headingsByRoot.get(root);
  if (!headings) {
    headings = [...(root as Document).querySelectorAll(HEADING_SELECTOR)];
    headingsByRoot.set(root, headings);
  }
  let found: Element | undefined;
  for (const h of headings) {
    if (h.compareDocumentPosition(el) & 4 /* FOLLOWING */) found = h;
    else break;
  }
  return found ? clean(found.textContent).slice(0, 80) || undefined : undefined;
}

function authorIndex(name: string, id: string, heading: string | undefined): number | undefined {
  const m = /author\D{0,3}(\d+)/i.exec(name) ?? /author\D{0,3}(\d+)/i.exec(id) ?? /author\s*(\d+)/i.exec(heading ?? '');
  return m ? Number(m[1]) : undefined;
}

function selectHasValue(sel: HTMLSelectElement): boolean {
  if (sel.multiple) return [...sel.selectedOptions].some((o) => o.value !== '');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || opt.value === '' || PLACEHOLDER_OPTION.test(opt.text)) return false;
  return sel.selectedIndex > 0 || opt.hasAttribute('selected');
}

export function detectFields(doc: Document): DetectedField[] {
  const headingsByRoot = new Map<Node, Element[]>();
  const seenRadios = new Set<string>();
  const fields: DetectedField[] = [];

  for (const el of collectControls(doc)) {
    const tag = el.tagName.toLowerCase();
    let controlType: ControlType = 'contenteditable';
    let inputType: string | undefined;
    if (tag === 'input') {
      inputType = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (SKIPPED_INPUT_TYPES.has(inputType)) continue;
      controlType = inputType === 'checkbox' ? 'checkbox' : inputType === 'radio' ? 'radio-group' : 'input';
      if (inputType === 'radio') {
        const key = `${(el as HTMLInputElement).form?.id ?? ''}|${(el as HTMLInputElement).name}`;
        if ((el as HTMLInputElement).name && seenRadios.has(key)) continue;
        seenRadios.add(key);
      }
    } else if (tag === 'textarea') controlType = 'textarea';
    else if (tag === 'select') controlType = 'select';

    const name = el.getAttribute('name') ?? '';
    const id = el.id ?? '';
    const heading = sectionHeading(el, headingsByRoot);
    const label = labelText(el);
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
      authorIndex: authorIndex(name, id, heading),
    };

    let options: SelectOption[] | undefined;
    let hasValue = false;
    if (controlType === 'select') {
      const sel = el as HTMLSelectElement;
      options = [...sel.options].map((o) => ({ text: clean(o.text), value: o.value }));
      hasValue = selectHasValue(sel);
    } else if (controlType === 'contenteditable') hasValue = clean(el.textContent) !== '';
    else if (controlType === 'input' || controlType === 'textarea') {
      hasValue = (el as HTMLInputElement).value.trim() !== '';
    } else hasValue = (el as HTMLInputElement).checked;

    const maxLength = (el as HTMLInputElement).maxLength;
    fields.push({
      fieldId: `f${fields.length}`,
      element: el,
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
