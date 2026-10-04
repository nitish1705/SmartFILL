// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { analyzeDocument, applyResults, undoFill } from './index';

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const values = { 'personal.email': 'ada@example.edu', 'personal.first_name': 'Ada', 'personal.country': 'India' };

describe('detector', () => {
  it('extracts label, section heading, nearby text and select options', () => {
    const doc = page(`
      <h2>Author Information</h2>
      <label for="e">Email *</label><input id="e" name="em" type="email">
      <table><tr><td>Given name</td><td><input name="gn"></td></tr></table>
      <select name="c"><option value="">Pick</option><option value="IN">India</option></select>`);
    const { fields } = analyzeDocument(doc, { values });
    expect(fields[0]!.context).toMatchObject({ label: 'Email *', sectionHeading: 'Author Information' });
    expect(fields[1]!.context.nearbyText).toBe('Given name');
    expect(fields[2]!.options).toHaveLength(2);
    expect(fields[2]!.hasValue).toBe(false);
  });

  it('walks open shadow roots', () => {
    const doc = page('<div id="host"></div>');
    doc.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Email <input type="email"></label>';
    expect(analyzeDocument(doc, { values }).fields).toHaveLength(1);
  });
});

describe('filler', () => {
  it('fills through the native setter, fires events, and undoes', () => {
    const doc = page('<label>Email <input id="e" type="email"></label><label>First name <input id="f" value="Grace"></label>');
    const input = doc.getElementById('e') as HTMLInputElement;
    const events: string[] = [];
    for (const t of ['input', 'change', 'blur']) input.addEventListener(t, () => events.push(t));

    const analysis = analyzeDocument(doc, { values });
    const records = applyResults(analysis);
    expect(input.value).toBe('ada@example.edu');
    expect(events).toEqual(['input', 'change', 'blur']);
    // user-entered value untouched
    expect((doc.getElementById('f') as HTMLInputElement).value).toBe('Grace');

    expect(undoFill(records)).toBe(1);
    expect(input.value).toBe('');
  });

  it('selects the matching option', () => {
    const doc = page('<label>Country <select id="c"><option value="">-</option><option value="IN">India</option></select></label>');
    applyResults(analyzeDocument(doc, { values }));
    expect((doc.getElementById('c') as HTMLSelectElement).value).toBe('IN');
  });

  it('never clicks or submits anything', () => {
    const doc = page('<form id="f"><label>Email <input type="email"></label><button id="b" type="submit">Go</button></form>');
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const onClick = vi.fn();
    doc.getElementById('f')!.addEventListener('submit', onSubmit);
    doc.getElementById('b')!.addEventListener('click', onClick);
    applyResults(analyzeDocument(doc, { values }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('never writes into password / card fields', () => {
    const doc = page('<input type="password" name="pw"><input name="cardNumber"><input name="cvv">');
    const records = applyResults(analyzeDocument(doc, { values: { ...values, 'personal.first_name': 'x' } }), new Set(['auto', 'review', 'ask']));
    expect(records).toHaveLength(0);
  });
});
