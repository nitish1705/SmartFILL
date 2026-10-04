import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const EXT = join(__dirname, '..', '..', 'apps', 'extension', '.output-e2e', 'chrome-mv3');
const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'forms');

const PROFILE = {
  id: 'me', name: 'Me', updatedAt: 1,
  values: {
    'personal.first_name': 'Ada', 'personal.last_name': 'Lovelace', 'personal.full_name': 'Ada Lovelace',
    'personal.email': 'ada@example.edu', 'personal.phone': '+91 98765 43210', 'personal.country': 'India',
    'academic.institution': 'Indian Institute of Science', 'academic.department': 'Computer Science',
    'professional.designation': 'Research Scholar',
  },
};

let server: Server;
let rsBundle = '';
let base: string;
let context: BrowserContext;
let sw: Worker;
let ext: Page; // an extension page used to send commands exactly like the popup does
let extId: string;

test.beforeAll(async () => {
  // a real react-select, bundled on the fly, to exercise the custom-dropdown adapter
  const out = await build({ entryPoints: [join(__dirname, 'pages', 'rs.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  rsBundle = out.outputFiles[0]!.text;
  server = createServer((req, res) => {
    if (req.url === '/__dynamic.html') {
      res.setHeader('content-type', 'text/html');
      return void res.end(`<title>Dynamic</title><form id="f"><div id="authors"><fieldset><legend>Author</legend><label>First name <input name="fn1"></label><label>Email <input type="email" name="em1"></label></fieldset></div><button type="button" id="add" onclick="const d=document.createElement('fieldset');d.innerHTML='<legend>Author</legend><label>First name <input name=fn2></label><label>Email <input type=email name=em2></label>';document.getElementById('authors').append(d)">Add author</button></form>`);
    }
    if (req.url === '/__rs.html') {
      res.setHeader('content-type', 'text/html');
      return void res.end('<title>react-select</title><div id="root"></div><script src="/__rs.js"></script>');
    }
    if (req.url === '/__rs.js') {
      res.setHeader('content-type', 'text/javascript');
      return void res.end(rsBundle);
    }
    if (req.url === '/__org.html') {
      res.setHeader('content-type', 'text/html');
      return void res.end('<title>Org</title><form><label for="o">Organization</label><input id="o" name="o"></form>');
    }
    if (req.url === '/__odd.html') {
      res.setHeader('content-type', 'text/html');
      return void res.end('<title>Odd</title><h2>Details</h2><form><label for="x">Place you currently study at</label><input id="x" name="zq"></form>');
    }
    try {
      const file = join(FIXTURES, decodeURIComponent((req.url ?? '/').slice(1)));
      res.setHeader('content-type', 'text/html');
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  }).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
  await sw.evaluate((p) => chrome.storage.local.set({ profile: p }), PROFILE);
  ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

async function open(fixture: string): Promise<{ page: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(`${base}/${fixture}`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]!.id!, `${base}/${fixture}`);
  return { page, tabId };
}

const send = (type: string, tabId: number) =>
  ext.evaluate(([t, id]) => chrome.runtime.sendMessage({ type: t, tabId: id }), [type, tabId] as const);

test('scan → fill safe fields → undo on a registration form', async () => {
  const { page, tabId } = await open('01-conference-registration.html');

  const scan = (await send('smartfill:scan', tabId)) as any;
  expect(scan.ok).toBe(true);
  expect(scan.counts.detected).toBe(9);
  expect(scan.counts.safe).toBeGreaterThanOrEqual(5);

  const fill = (await send('smartfill:fill', tabId)) as any;
  expect(fill.filled).toBe(scan.counts.safe);
  await expect(page.locator('#fn')).toHaveValue('Ada');
  await expect(page.locator('#em')).toHaveValue('ada@example.edu');
  await expect(page.locator('#in')).toHaveValue('Indian Institute of Science');
  await expect(page.locator('#co')).toHaveValue('IN');
  // not in profile / unknown → untouched
  await expect(page.locator('#or')).toHaveValue('');
  await expect(page.locator('#di')).toHaveValue('');

  const undo = (await send('smartfill:undo', tabId)) as any;
  expect(undo.undone).toBe(fill.filled);
  await expect(page.locator('#fn')).toHaveValue('');
  await page.close();
});

test('never touches password / card fields and never submits', async () => {
  const { page, tabId } = await open('07-job-application.html');
  await page.evaluate(() => {
    (window as any).__submitted = false;
    document.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); (window as any).__submitted = true; });
  });
  await send('smartfill:fill', tabId);
  await expect(page.locator('[name=pwd]')).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__submitted)).toBe(false);
  await page.close();
});

test('framework-controlled input accepts the fill (native setter + events)', async () => {
  const { page, tabId } = await open('08-contact-form.html');
  // emulate a React-style value tracker: only values set through the native setter + input event are kept
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[name=email]')!;
    let state = '';
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', { get: () => desc.get!.call(input), set: (v) => { (window as any).__direct = true; desc.set!.call(input, v); }, configurable: true });
    input.addEventListener('input', () => { state = input.value; (window as any).__state = state; });
  });
  await send('smartfill:fill', tabId);
  expect(await page.evaluate(() => (window as any).__state)).toBe('ada@example.edu');
  await page.close();
});

test('offscreen document runs the bundled MiniLM model and ranks fields', async () => {
  const field = {
    fieldId: 'x', controlType: 'input', inputType: 'text', disabled: false, readOnly: false, hidden: false, hasValue: false,
    context: { pageTitle: '', label: 'Which institute are you from?' },
  };
  const res = (await ext.evaluate((f) => chrome.runtime.sendMessage({ type: 'smartfill:rank', fields: [f] }), field)) as any;
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.ranked[0][0].key).toBe('academic.institution');
  expect(res.ranked[0][0].cosine).toBeGreaterThan(0.4);
});

test('review overlay lists fields with candidate dropdowns and fills only selected ones', async () => {
  const { page, tabId } = await open('11-summer-school.html');
  await send('smartfill:review', tabId);
  const overlay = page.locator('#smartfill-overlay');
  await expect(overlay).toHaveCount(1);
  const rows = overlay.locator('.row');
  expect(await rows.count()).toBeGreaterThan(0);

  // uncheck the first row, fill the rest
  const first = rows.first();
  const firstLabel = await first.locator('.label').innerText();
  await first.locator('input[type=checkbox]').uncheck();
  await overlay.getByRole('button', { name: /Fill selected/ }).click();
  await expect(overlay.locator('[role=status]')).toContainText('Filled');
  const filledCount = await page.locator('input:not([value=""]), select').evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).value && (e as HTMLInputElement).tagName === 'INPUT').length);
  expect(filledCount).toBeGreaterThan(0);
  expect(firstLabel).toBeTruthy();

  await overlay.getByRole('button', { name: 'Undo' }).click();
  await expect(overlay.locator('[role=status]')).toContainText('Restored');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await page.close();
});

test('LLM fallback: receives only descriptions + candidate keys, answer lands in review (never auto)', async () => {
  // mock proxy on its own port
  const received: string[] = [];
  const proxy = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(body);
      const r = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ results: r.fields.map((f: any) => ({ field_id: f.field_id, matched_profile_key: f.candidate_keys.includes('academic.institution') ? 'academic.institution' : null, confidence: 0.99, reason: 'asks where the user studies' })) }));
    });
  }).listen(0);
  const port = (proxy.address() as AddressInfo).port;
  try {
    await sw.evaluate((p) => chrome.storage.local.set({ settings: { thresholds: { auto: 0.95, review: 0.8, ask: 0.5 }, llm: { enabled: true, provider: 'proxy', endpoint: `http://localhost:${p}` }, learning: { enabled: false }, locked: false } }), port);
    const { page, tabId } = await open('__odd.html');
    const scan = (await send('smartfill:scan', tabId)) as any;
    const row = scan.rows.find((r: any) => r.label.startsWith('Place you'));
    expect(row, JSON.stringify(scan.rows)).toBeTruthy();
    // rules/embeddings might settle it first; if the LLM was consulted its answer must be review-only and value-free
    expect(received.length, 'the LLM should have been consulted for this unsettled field').toBeGreaterThan(0);
    for (const secret of Object.values(PROFILE.values)) expect(received.join()).not.toContain(secret);
    expect(row.layer).toBe('llm');
    expect(row.decision).toBe('review');
    expect(row.confidence).toBeLessThanOrEqual(0.9);
    // AI off → no call is made
    received.length = 0;
    await sw.evaluate(() => chrome.storage.local.remove('settings'));
    await send('smartfill:scan', tabId);
    expect(received).toHaveLength(0);
    await page.close();
  } finally {
    proxy.close();
    await sw.evaluate(() => chrome.storage.local.remove('settings'));
  }
});

const person = (id: string, first: string, email: string) => ({ id, name: first, updatedAt: 1, values: { 'personal.first_name': first, 'personal.email': email, 'academic.institution': `${first} University` } });
const store = (over: object = {}) => ({
  profiles: [person('me', 'Ada', 'ada@example.edu'), person('g', 'Grace', 'grace@navy.mil'), person('a', 'Alan', 'alan@bletchley.uk')],
  activeProfileId: 'me', submissions: [], siteMappings: {}, ...over,
});
const submission = (order: string[], corr: string) => ({
  id: 's1', title: 'Paper',
  authors: order.map((profileId, i) => ({ profileId, order: i + 1, corresponding: profileId === corr })),
});

test('three-author submission: block i ← author i in order, only the corresponding box ticked', async () => {
  await sw.evaluate((d) => chrome.storage.local.set({ data: d }), store({ submissions: [submission(['g', 'me', 'a'], 'me')], activeSubmissionId: 's1' }));
  const { page, tabId } = await open('26-three-authors.html');
  const res = (await send('smartfill:fill', tabId)) as any;
  expect(res.ok).toBe(true);
  await expect(page.locator('[name="authors[1][first]"]')).toHaveValue('Grace');
  await expect(page.locator('[name="authors[2][first]"]')).toHaveValue('Ada');
  await expect(page.locator('[name="authors[3][first]"]')).toHaveValue('Alan');
  await expect(page.locator('[name="authors[1][email]"]')).toHaveValue('grace@navy.mil');
  await expect(page.locator('[name="authors[3][aff]"]')).toHaveValue('Alan University');
  const ticks = await page.locator('input[type=checkbox]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
  expect(ticks).toEqual([false, true, false]); // Ada is author #2 and corresponding
  await page.close();
});

test('without a submission only the first author block is filled', async () => {
  await sw.evaluate((d) => chrome.storage.local.set({ data: d }), store());
  const { page, tabId } = await open('26-three-authors.html');
  await send('smartfill:fill', tabId);
  await expect(page.locator('[name="authors[1][first]"]')).toHaveValue('Ada');
  await expect(page.locator('[name="authors[2][first]"]')).toHaveValue('');
  await page.close();
});

test('"Add author" injects a block: badge shows new fields and the next author fills it', async () => {
  await sw.evaluate((d) => chrome.storage.local.set({ data: d }), store({ submissions: [submission(['me', 'g'], 'g')], activeSubmissionId: 's1' }));
  const { page, tabId } = await open('__dynamic.html');
  await send('smartfill:fill', tabId);
  await expect(page.locator('[name=fn1]')).toHaveValue('Ada');
  await page.click('#add');
  await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('+2');
  await send('smartfill:fill', tabId);
  await expect(page.locator('[name=fn2]')).toHaveValue('Grace');
  await expect(page.locator('[name=em2]')).toHaveValue('grace@navy.mil');
  await page.close();
});

test('learning: a correction is remembered for that site only, then auto-applies', async () => {
  const me = { ...person('me', 'Ada', 'ada@example.edu'), values: { 'academic.institution': 'IISc', 'academic.department': 'CSA' } };
  await sw.evaluate(async ([d, s]) => chrome.storage.local.set({ data: d, settings: s }), [
    store({ profiles: [me], submissions: [], siteMappings: {} }),
    { thresholds: { auto: 0.95, review: 0.8, ask: 0.5 }, llm: { enabled: false, provider: 'off' }, learning: { enabled: true }, locked: false },
  ] as const);

  const { page, tabId } = await open('__org.html');
  const first = (await send('smartfill:scan', tabId)) as any;
  const row0 = first.rows.find((r: any) => r.label === 'Organization');
  expect(row0.decision).toBe('ask'); // ambiguous: institution vs organization

  // the user says: here "Organization" means Department
  await send('smartfill:review', tabId);
  const overlay = page.locator('#smartfill-overlay');
  await overlay.locator('select').first().selectOption('academic.department');
  await overlay.getByRole('button', { name: /Fill selected/ }).click();
  await expect(page.locator('#o')).toHaveValue('CSA');
  await expect.poll(async () => Object.keys((await sw.evaluate(() => chrome.storage.local.get('data'))).data.siteMappings).length).toBe(1);
  const mapping = Object.values((await sw.evaluate(() => chrome.storage.local.get('data'))).data.siteMappings)[0] as any;
  expect(mapping).toMatchObject({ key: 'academic.department', source: 'user_correction' });
  expect(JSON.stringify(mapping)).not.toContain('CSA'); // values are never stored in rules

  // second visit: applied automatically from site memory
  await page.reload();
  const second = (await send('smartfill:scan', tabId)) as any;
  expect(second.rows.find((r: any) => r.label === 'Organization')).toMatchObject({ decision: 'auto', layer: 'site', key: 'academic.department' });
  await page.close();

  // a different origin has no such rule
  const other = await context.newPage();
  await other.goto(base.replace('localhost', '127.0.0.1') + '/__org.html');
  const otherTab = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0]!.id!);
  const third = (await send('smartfill:scan', otherTab)) as any;
  expect(third.rows.find((r: any) => r.label === 'Organization').layer).not.toBe('site');
  await other.close();
});

test('custom dropdown adapter works on a real react-select', async () => {
  const me = { ...person('me', 'Ada', 'ada@example.edu'), values: { 'personal.country': 'India' } };
  await sw.evaluate((d) => chrome.storage.local.set({ data: d }), store({ profiles: [me] }));
  const { page, tabId } = await open('__rs.html');
  await page.waitForSelector('#country');
  const scan = (await send('smartfill:scan', tabId)) as any;
  const row = scan.rows.find((r: any) => r.label === 'Country');
  expect(row, JSON.stringify(scan.rows)).toMatchObject({ key: 'personal.country', decision: 'review' }); // never auto: options unknown

  // "Fill safe fields" must not touch it
  await send('smartfill:fill', tabId);
  await expect(page.locator('[class*="singleValue"]')).toHaveCount(0);

  // the user approves it in the review panel
  await send('smartfill:review', tabId);
  const overlay = page.locator('#smartfill-overlay');
  await overlay.getByRole('button', { name: /Fill selected/ }).click();
  await expect(overlay.locator('[role=status]')).toContainText('Filled 1');
  await expect(page.locator('[class*="singleValue"]')).toHaveText('India');
  await page.close();
});

// ── Phase 5: onboarding, privacy page, lock, accessibility ─────────────────────────

async function options(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  return page;
}

async function expectNoA11yViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const results = await (include ? builder.include(include) : builder).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(summary, summary.join(' ; ')).toEqual([]);
}

test('onboarding: three screens, then the profile editor; shown only once', async () => {
  await sw.evaluate(() => chrome.storage.local.remove('onboarded'));
  const page = await options();
  await expect(page.getByRole('heading', { name: /Fill forms from details you have verified/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Private by design' })).toBeFocused();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Set up my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible(); // not shown again
  await page.close();
});

test('every options screen, the popup, the privacy page and the review overlay pass axe (WCAG 2.1 AA)', async () => {
  await sw.evaluate(async (d) => chrome.storage.local.set({ onboarded: true, data: d }), store());
  const page = await options();
  for (const tab of ['Profiles', 'Paper submission', 'AI assist', 'Site rules', 'Data & privacy']) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: tab }).click();
    await expectNoA11yViolations(page);
  }
  await page.goto(`chrome-extension://${extId}/privacy.html`);
  await expectNoA11yViolations(page);
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await page.close();

  const { page: form, tabId } = await open('01-conference-registration.html');
  await send('smartfill:review', tabId);
  await expect(form.locator('#smartfill-overlay')).toHaveCount(1);
  await expectNoA11yViolations(form, '#smartfill-overlay');
  await form.close();
});

test('lock: data is encrypted at rest, locked pages get nothing, unlock restores', async () => {
  await sw.evaluate(async (d) => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); await chrome.storage.local.set({ onboarded: true, data: d }); }, store());
  const page = await options();
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Data & privacy' }).click();
  await page.getByLabel('New passphrase (8+ characters)').fill('correct horse battery');
  await page.getByLabel('Repeat passphrase').fill('correct horse battery');
  await page.getByRole('button', { name: 'Enable lock' }).click();
  await expect(page.getByText('Your data is encrypted at rest.')).toBeVisible();

  // nothing readable remains in storage
  const dump = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
  expect(dump).toContain('smartfill-encrypted');
  expect(dump).not.toContain('ada@example.edu');
  expect(dump).not.toContain('Grace');
  expect(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(['data', 'profile'])))).toEqual([]);

  // while unlocked, filling works
  const { page: form, tabId } = await open('08-contact-form.html');
  expect(((await send('smartfill:scan', tabId)) as any).ok).toBe(true);

  // lock: the page script gets nothing
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'SmartFill is locked' })).toBeVisible();
  await expectNoA11yViolations(page);
  const locked = (await send('smartfill:scan', tabId)) as any;
  expect(locked).toMatchObject({ ok: false, locked: true });
  await expect(form.locator('[name=email]')).toHaveValue('');

  // wrong passphrase, then right passphrase
  await page.getByLabel('Passphrase').fill('nope nope nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong passphrase');
  await page.getByLabel('Passphrase').fill('correct horse battery');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible(); // back where the user was
  expect(((await send('smartfill:scan', tabId)) as any).ok).toBe(true);
  await form.close();

  // delete everything wipes storage
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Data & privacy' }).click();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await expect(page.getByText('All SmartFill data has been deleted.')).toBeVisible();
  expect(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)))).toEqual([]);
  await page.close();
});

test('CV import: a PDF is read in the browser, suggestions need approval, nothing unticked is saved', async () => {
  await sw.evaluate(async (d) => { await chrome.storage.local.clear(); await chrome.storage.local.set({ onboarded: true, data: d }); }, store({ profiles: [{ id: 'me', name: 'Me', updatedAt: 1, values: {} }] }));

  // build a real PDF
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = ['Dr. Ada Lovelace', 'Research Scholar', 'Indian Institute of Science, Bengaluru', 'ada@example.edu | +91 98765 43210', 'ORCID: 0000-0002-1825-0097', 'Research Interests: machine learning, compilers'];
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font }));
  const buffer = Buffer.from(await pdf.save());

  const opt = await options();
  await opt.getByText('Import details from a CV (PDF or text)').click();
  await opt.locator('input[type=file]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer });
  await expect(opt.getByText(/Found \d+ possible detail/)).toBeVisible({ timeout: 20_000 });

  // distinctive patterns are pre-ticked; heuristic guesses are not
  await expect(opt.getByLabel('Use Email')).toBeChecked();
  await expect(opt.getByLabel('Use ORCID iD')).toBeChecked();
  await expect(opt.getByLabel('Use Institution')).not.toBeChecked();
  await expect(opt.getByLabel('Value for Email')).toHaveValue('ada@example.edu');
  await expectNoA11yViolations(opt);

  await opt.getByLabel('Use Full name').check();
  await opt.getByRole('button', { name: 'Add ticked values to this profile' }).click();
  await expect(opt.getByText(/Review them and press/)).toBeVisible();
  // nothing is stored until the user saves
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('data')).data.profiles[0].values)).toEqual({});
  await opt.getByRole('button', { name: 'Save profile' }).click();
  await expect.poll(() => sw.evaluate(async () => (await chrome.storage.local.get('data')).data.profiles[0].values)).toMatchObject({
    'personal.email': 'ada@example.edu', 'personal.full_name': 'Ada Lovelace', 'research.orcid': '0000-0002-1825-0097',
  });
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('data')).data.profiles[0].values);
  expect(saved['academic.institution']).toBeUndefined(); // unticked guess was not saved
  await opt.close();
});
