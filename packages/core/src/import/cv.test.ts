import { describe, expect, it } from 'vitest';
import { extractFromCv } from './cv';

const CV = `Dr. Ada Lovelace
Research Scholar
Department of Computer Science and Automation
Indian Institute of Science, Bengaluru
ada@example.edu | +91 98765 43210
ORCID: 0000-0002-1825-0097
https://scholar.google.com/citations?user=AbCdEf123&hl=en

Education
Ph.D. in Computer Science, Indian Institute of Science, 2021-2026
M.Sc., University of Cambridge, 2019

Research Interests: machine learning, natural language processing
and probabilistic programming

Publications
Lovelace A. (2024). A paper. 10.1000/xyz 2024 2025 2026
`;

describe('CV extraction', () => {
  const byKey = Object.fromEntries(extractFromCv(CV).map((s) => [s.key, s]));

  it('extracts distinctive identifiers with evidence', () => {
    expect(byKey['personal.email']).toMatchObject({ value: 'ada@example.edu', confidence: 'high' });
    expect(byKey['research.orcid']!.value).toBe('0000-0002-1825-0097');
    expect(byKey['research.google_scholar']!.value).toContain('user=AbCdEf123');
    expect(byKey['personal.phone']!.value).toBe('+91 98765 43210');
    expect(byKey['personal.email']!.evidence).toContain('ada@example.edu');
  });

  it('extracts name, affiliation and academic details heuristically (medium confidence)', () => {
    expect(byKey['personal.full_name']).toMatchObject({ value: 'Ada Lovelace', confidence: 'medium' });
    expect(byKey['personal.first_name']!.value).toBe('Ada');
    expect(byKey['personal.last_name']!.value).toBe('Lovelace');
    expect(byKey['academic.institution']!.value).toBe('Indian Institute of Science, Bengaluru');
    expect(byKey['academic.department']!.value).toBe('Department of Computer Science and Automation');
    expect(byKey['academic.degree']!.value).toBe('Ph.D.');
    expect(byKey['professional.designation']!.value).toBe('Research Scholar');
    expect(byKey['research.research_interests']!.value).toBe('machine learning, natural language processing and probabilistic programming');
  });

  it('never invents values: nothing from empty or irrelevant text, no years or ORCID digits as phones', () => {
    expect(extractFromCv('')).toEqual([]);
    expect(extractFromCv('Lorem ipsum dolor sit amet\nconsectetur 2019-2024')).toEqual([]);
    expect(extractFromCv('0000-0002-1825-0097 and years 2019 2020 2021 2022')).not.toContainEqual(expect.objectContaining({ key: 'personal.phone' }));
  });

  it('gives each key at most once and only registry keys', async () => {
    const { getKeyDef } = await import('../registry/keys');
    const all = extractFromCv(CV + '\nsecond@example.org');
    expect(new Set(all.map((s) => s.key)).size).toBe(all.length);
    expect(all.every((s) => !!getKeyDef(s.key))).toBe(true);
    expect(all.find((s) => s.value === 'second@example.org')!.key).toBe('personal.alt_email');
  });
});
