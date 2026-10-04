import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from '@smartfill/core';
import { createNodeEmbedder, modelAvailable } from './embedder';
import { evaluate, riskCoverage, loadFixtures, refOf, type Metrics } from './evaluate';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function summary(name: string, m: Metrics) {
  return {
    config: name,
    fields: m.fields,
    fills: m.fills,
    precision: pct(m.precision),
    'recall(auto)': pct(m.recall),
    'prec(+review)': pct(m.precisionWithReview),
    'recall(+review)': pct(m.recallWithReview),
    FAR: pct(m.falseAutofillRate),
    USR: pct(m.unknownSafetyRate),
    coverage: pct(m.coverage),
    'ms/form': m.medianMs.toFixed(1),
  };
}

(async () => {
  const rules = await evaluate();
  const table = [summary('rules', rules)];
  let best = rules;

  if (modelAvailable()) {
    const base: Embedder = await createNodeEmbedder();
    let calls = 0;
    const embedder: Embedder = async (t) => ((calls += t.length), base(t));
    await embedder(['warm up']); // load model + JIT outside the timing
    const withEmb = await evaluate({ embedder });
    table.push(summary('rules + embeddings', withEmb));
    best = withEmb;

    // Upper bound for the LLM layer: an oracle that follows the protocol perfectly (answers the true key when
    // it is among the candidates, else null). A real model can only do worse; run services/llm-proxy to measure it.
    const truth = new Map<string, string | null>();
    for (const fx of loadFixtures()) for (const [ref, key] of Object.entries(fx.truth)) truth.set(`${fx.file}|${ref}`, key);
    const withLlm = await evaluate({
      embedder,
      llm: async (request, ctx) => ({
        results: request.fields.map((f) => {
          const key = truth.get(ctx.lookup(f.field_id)) ?? null;
          return { field_id: f.field_id, matched_profile_key: key && f.candidate_keys.includes(key) ? key : null, confidence: 0.9, reason: 'oracle' };
        }),
      }),
    });
    table.push(summary('rules + emb + LLM (oracle upper bound)', withLlm));
    best = withLlm;
    console.log(`embedding texts per run: ${calls}`);
  } else {
    console.log('(embedding model not found: run `npm run fetch-model` to include the embeddings ablation)');
  }

  console.table(table);
  const interesting = best.rows.filter((r) => r.decision !== 'auto' && (r.matchable || r.got) || !r.ok);
  console.table(interesting.map((r) => ({ form: r.form.slice(0, 22), ref: r.ref, expected: r.expected, got: r.got, decision: r.decision, layer: r.layer, conf: r.confidence })));

  const curve = riskCoverage(best.rows);
  const csv = ['threshold,coverage,false_autofill_rate', ...curve.map((c) => `${c.threshold},${c.coverage.toFixed(4)},${c.far.toFixed(4)}`)].join('\n');
  writeFileSync(join(__dirname, 'risk-coverage.csv'), csv + '\n');
  writeFileSync(join(__dirname, 'results.json'), JSON.stringify(table, null, 2) + '\n');

  if (best.problems.length) {
    console.error('\nFixture problems:\n' + best.problems.join('\n'));
    process.exitCode = 1;
  }
})();
