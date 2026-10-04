import { evaluate } from './evaluate';

const m = evaluate();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.table(m.rows.filter((r) => r.decision !== 'auto' || !r.ok || r.expected !== r.got));
console.log(`forms=${m.forms} fields=${m.fields} matchable=${m.matchable} fills=${m.fills}`);
console.log(`precision            ${pct(m.precision)}`);
console.log(`recall (auto only)   ${pct(m.recall)}`);
console.log(`recall (auto+review) ${pct(m.recallWithReview)}`);
console.log(`false autofill rate  ${pct(m.falseAutofillRate)}`);
console.log(`unknown safety rate  ${pct(m.unknownSafetyRate)}`);
console.log(`coverage             ${pct(m.coverage)}`);
if (m.problems.length) {
  console.error('\nFixture problems:\n' + m.problems.join('\n'));
  process.exitCode = 1;
}
