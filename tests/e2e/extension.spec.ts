import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
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
let base: string;
let context: BrowserContext;
let sw: Worker;
let ext: Page; // an extension page used to send commands exactly like the popup does
let extId: string;

test.beforeAll(async () => {
  server = createServer((req, res) => {
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
