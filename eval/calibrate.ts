// Fits Platt scaling (p = sigmoid(a·cos + b)) for the embedding layer on the fixture set.
//   npm run calibrate   (needs `npm run fetch-model`)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createEmbeddingIndex, escalationCandidates } from '@smartfill/core';
import { detectFields } from '@smartfill/dom';
import { createNodeEmbedder } from './embedder';
import { loadFixtures, profile, refOf } from './evaluate';

(async () => {
  const embed = await createNodeEmbedder();
  const index = createEmbeddingIndex(embed, { a: 1, b: 0 });
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { html, truth } of loadFixtures()) {
    const fields = detectFields(new JSDOM(html).window.document);
    // only fields the rules could not settle ever reach the embedding layer
    const open = escalationCandidates(fields, { values: profile });
    const ranked = await index.rank(open);
    open.forEach((f, i) => {
      const top = ranked[i]![0];
      if (!top) return;
      xs.push(top.cosine);
      ys.push(truth[refOf(f.context, f.fieldId)] === top.key ? 1 : 0);
    });
  }
  // logistic regression by gradient descent
  let a = 5, b = -2;
  for (let it = 0; it < 20000; it++) {
    let ga = 0, gb = 0;
    xs.forEach((x, i) => {
      const p = 1 / (1 + Math.exp(-(a * x + b)));
      ga += (p - ys[i]!) * x;
      gb += p - ys[i]!;
    });
    a -= (0.5 * ga) / xs.length;
    b -= (0.5 * gb) / xs.length;
  }
  const pos = ys.filter(Boolean).length;
  console.log(`samples=${xs.length} positives=${pos}  a=${a.toFixed(3)} b=${b.toFixed(3)}`);
  writeFileSync(join(__dirname, '..', 'packages', 'core', 'src', 'embedding', 'calibration.json'), JSON.stringify({ a: +a.toFixed(3), b: +b.toFixed(3) }) + '\n');
})();
