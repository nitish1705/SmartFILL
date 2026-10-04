// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { analyzeDocument, applyResults, undoFill, watchForNewFields } from './index';

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const values = { 'personal.email': 'ada@example.edu', 'personal.first_name': 'Ada', 'personal.country': 'India' };

describe('detector', () => {
  it('extracts label, section heading, nearby text and select options', async () => {
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

  it('walks open shadow roots', async () => {
    const doc = page('<div id="host"></div>');
    doc.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Email <input type="email"></label>';
    expect(analyzeDocument(doc, { values }).fields).toHaveLength(1);
  });
});

describe('filler', () => {
  it('fills through the native setter, fires events, and undoes', async () => {
    const doc = page('<label>Email <input id="e" type="email"></label><label>First name <input id="f" value="Grace"></label>');
    const input = doc.getElementById('e') as HTMLInputElement;
    const events: string[] = [];
    for (const t of ['input', 'change', 'blur']) input.addEventListener(t, () => events.push(t));

    const analysis = analyzeDocument(doc, { values });
    const records = await applyResults(analysis);
    expect(input.value).toBe('ada@example.edu');
    expect(events).toEqual(['input', 'change', 'blur']);
    // user-entered value untouched
    expect((doc.getElementById('f') as HTMLInputElement).value).toBe('Grace');

    expect(undoFill(records)).toBe(1);
    expect(input.value).toBe('');
  });

  it('selects the matching option', async () => {
    const doc = page('<label>Country <select id="c"><option value="">-</option><option value="IN">India</option></select></label>');
    await applyResults(analyzeDocument(doc, { values }));
    expect((doc.getElementById('c') as HTMLSelectElement).value).toBe('IN');
  });

  it('never clicks or submits anything', async () => {
    const doc = page('<form id="f"><label>Email <input type="email"></label><button id="b" type="submit">Go</button></form>');
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const onClick = vi.fn();
    doc.getElementById('f')!.addEventListener('submit', onSubmit);
    doc.getElementById('b')!.addEventListener('click', onClick);
    await applyResults(analyzeDocument(doc, { values }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('never writes into password / card fields', async () => {
    const doc = page('<input type="password" name="pw"><input name="cardNumber"><input name="cvv">');
    const records = await applyResults(analyzeDocument(doc, { values: { ...values, 'personal.first_name': 'x' } }), new Set(['auto', 'review', 'ask']));
    expect(records).toHaveLength(0);
  });
});

describe('radio groups, checkboxes and author blocks', () => {
  const v = { 'personal.gender': 'Female', 'personal.first_name': 'Ada', 'personal.email': 'ada@example.edu' };

  it('selects the matching radio and undo clears it', async () => {
    const doc = page('<fieldset><legend>Gender</legend><label><input type="radio" name="g" value="m"> Male</label><label><input type="radio" name="g" value="f"> Female</label></fieldset>');
    const a = analyzeDocument(doc, { values: v });
    expect(a.fields).toHaveLength(1);
    expect(a.fields[0]!.options!.map((o) => o.text)).toEqual(['Male', 'Female']);
    const records = await applyResults(a);
    expect((doc.querySelector('input[value=f]') as HTMLInputElement).checked).toBe(true);
    expect((doc.querySelector('input[value=m]') as HTMLInputElement).checked).toBe(false);
    undoFill(records);
    expect((doc.querySelector('input[value=f]') as HTMLInputElement).checked).toBe(false);
  });

  const blocks = (legends: string[]) =>
    legends.map((l, i) => `<fieldset><legend>${l}</legend><label>First name <input name="fn${i}"></label><label><input type="checkbox" name="co${i}"> Corresponding author</label></fieldset>`).join('');
  const authors = [
    { values: { 'personal.first_name': 'Ada' }, corresponding: false },
    { values: { 'personal.first_name': 'Grace' }, corresponding: true },
  ];

  it('fills each numbered author block from the submission and ticks only the corresponding author', async () => {
    const doc = page(blocks(['Author 1', 'Author 2']));
    await applyResults(analyzeDocument(doc, { values: v, authors }));
    expect([...doc.querySelectorAll<HTMLInputElement>('input[name^=fn]')].map((i) => i.value)).toEqual(['Ada', 'Grace']);
    expect([...doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((i) => i.checked)).toEqual([false, true]);
  });

  it('numbers unnumbered "Author" blocks by position', async () => {
    const doc = page(blocks(['Author', 'Author']));
    await applyResults(analyzeDocument(doc, { values: v, authors }));
    expect([...doc.querySelectorAll<HTMLInputElement>('input[name^=fn]')].map((i) => i.value)).toEqual(['Ada', 'Grace']);
  });

  it('radios labelled "corresponding author" are single boolean fields; never unticks', async () => {
    const doc = page('<fieldset><legend>Author 1</legend><label><input type="radio" name="c" value="1"> Corresponding author</label></fieldset><fieldset><legend>Author 2</legend><label><input type="radio" name="c" value="2" checked> Corresponding author</label></fieldset>');
    await applyResults(analyzeDocument(doc, { values: v, authors: [{ values: {}, corresponding: true }, { values: {}, corresponding: true }] }));
    const [r1, r2] = [...doc.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(r2!.checked).toBe(true); // already set by the page: untouched
    expect(r1!.checked).toBe(false); // would steal the group's single selection → left alone
  });
});

describe('custom dropdowns and dynamic forms', () => {
  function combobox(): Document {
    const doc = page('<label id="l">Country</label><div role="combobox" id="cb" aria-labelledby="l" tabindex="0">Select</div>');
    const cb = doc.getElementById('cb')!;
    cb.addEventListener('mousedown', () => {
      if (doc.getElementById('list')) return;
      const ul = doc.createElement('ul');
      ul.id = 'list';
      ul.setAttribute('role', 'listbox');
      for (const t of ['United States', 'India', 'Germany']) {
        const li = doc.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = t;
        li.addEventListener('click', () => { cb.textContent = t; ul.remove(); });
        ul.append(li);
      }
      doc.body.append(ul);
    });
    return doc;
  }

  it('is detected as custom, capped at review, and filled by clicking the matching option', async () => {
    const doc = combobox();
    const a = analyzeDocument(doc, { values: { 'personal.country': 'India' } });
    expect(a.fields[0]!.controlType).toBe('custom');
    expect(a.results[0]!.decision).toBe('review');
    expect(await applyResults(a)).toHaveLength(0); // review is not auto: needs approval
    const records = await applyResults(a, new Set(['review']));
    expect(records).toHaveLength(1);
    expect(doc.getElementById('cb')!.textContent).toBe('India');
  });

  it('writes nothing when no option matches', async () => {
    const doc = combobox();
    const a = analyzeDocument(doc, { values: { 'personal.country': 'Atlantis' } });
    expect(await applyResults(a, new Set(['review']))).toHaveLength(0);
    expect(doc.getElementById('cb')!.textContent).toBe('Select');
  });

  it('reports fields added later (Add Author)', async () => {
    const doc = page('<div id="host"><input name="a"></div>');
    let calls = 0;
    const stop = watchForNewFields(doc, () => calls++, 20);
    doc.getElementById('host')!.append(Object.assign(doc.createElement('input'), { name: 'b' }));
    await new Promise((r) => setTimeout(r, 120));
    doc.getElementById('host')!.append(doc.createElement('span')); // not a control
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(calls).toBe(1);
  });
});
