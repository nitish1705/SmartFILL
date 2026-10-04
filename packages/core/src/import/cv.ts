/**
 * Rule-based extraction of profile *suggestions* from CV text.
 *
 * Everything here is untrusted: the output is a review queue the user must approve line by line before
 * anything becomes part of a profile. No generation, no network, no LLM — document text never leaves the device.
 */

export interface CvSuggestion {
  key: string;
  value: string;
  /** The line the value came from, shown to the user as evidence. */
  evidence: string;
  /** `high` = a distinctive pattern (email, ORCID…); `medium` = a heuristic (name, institution…). */
  confidence: 'high' | 'medium';
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ORCID = /\b(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/;
const SCHOLAR = /https?:\/\/scholar\.google\.[a-z.]+\/citations\?[^\s)>\]]*user=[\w-]+[^\s)>\]]*/i;
// +CC and 8–13 digits with common separators, or a bare 10-digit number
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,4}/g;
const NAME_LINE = /^(?:(?:Dr|Prof|Mr|Ms|Mrs)\.?\s+)?([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]*){1,3})$/u;
const INSTITUTION = /\b(University|Institute|College|Polytechnic|Laborator(?:y|ies)|School of)\b/i;
const DEPARTMENT = /^(?:Department|Dept\.?|Division|Faculty) (?:of|for)\b.{2,70}$/i;
const DEGREE = /\b(Ph\.?\s?D\.?|M\.?\s?Sc\.?|B\.?\s?Sc\.?|M\.?\s?Tech\.?|B\.?\s?Tech\.?|M\.?\s?Eng\.?|B\.?\s?Eng\.?|M\.?\s?A\.?|B\.?\s?A\.?|Master of [A-Z][A-Za-z ]{2,40}|Bachelor of [A-Z][A-Za-z ]{2,40}|Doctor of [A-Z][A-Za-z ]{2,40})(?=[\s,.;)]|$)/;
const DESIGNATION = /\b((?:Senior |Junior |Assistant |Associate |Visiting )?(?:Professor|Lecturer|Research Scholar|Research Scientist|Research Fellow|Postdoctoral (?:Researcher|Fellow|Associate)|Software Engineer|Data Scientist|Doctoral Student|PhD Student|Graduate Student))\b/i;
const SECTION_INTERESTS = /^research (?:interests?|areas?)\s*:?\s*(.*)$/i;
const SECTION_END = /^(?:education|experience|publications?|projects?|skills|awards?|references|employment|teaching|contact)\b/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function extractFromCv(text: string): CvSuggestion[] {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
  const out: CvSuggestion[] = [];
  const have = new Set<string>();
  const add = (s: CvSuggestion) => {
    if (!have.has(s.key) && s.value) {
      have.add(s.key);
      out.push({ ...s, evidence: s.evidence.slice(0, 120) });
    }
  };
  const head = lines.slice(0, 12);

  // name: first short line of 2–4 capitalised words without digits or @
  for (const l of head) {
    if (/[\d@:/]/.test(l) || l.length > 50) continue;
    const m = NAME_LINE.exec(l);
    if (m && !INSTITUTION.test(l) && !/curriculum|vitae|resume|résumé/i.test(l)) {
      const full = m[1]!.trim();
      const parts = full.split(' ');
      add({ key: 'personal.full_name', value: full, evidence: l, confidence: 'medium' });
      if (parts.length >= 2) {
        add({ key: 'personal.first_name', value: parts[0]!, evidence: l, confidence: 'medium' });
        add({ key: 'personal.last_name', value: parts[parts.length - 1]!, evidence: l, confidence: 'medium' });
      }
      break;
    }
  }

  for (const l of lines) {
    const emails = l.match(EMAIL);
    if (emails) {
      emails.forEach((e, i) => add({ key: have.has('personal.email') || i > 0 ? 'personal.alt_email' : 'personal.email', value: e, evidence: l, confidence: 'high' }));
    }
    const orcid = ORCID.exec(l);
    if (orcid) add({ key: 'research.orcid', value: orcid[1]!, evidence: l, confidence: 'high' });
    const scholar = SCHOLAR.exec(l);
    if (scholar) add({ key: 'research.google_scholar', value: scholar[0], evidence: l, confidence: 'high' });
  }

  // phone: search the header region first; ignore ORCID-like and year-range matches
  for (const l of head.concat(lines)) {
    if (ORCID.test(l)) continue;
    for (const m of l.matchAll(PHONE)) {
      const raw = clean(m[0]);
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 13 && !/^(?:19|20)\d{2}/.test(digits)) {
        add({ key: 'personal.phone', value: raw, evidence: l, confidence: 'medium' });
        break;
      }
    }
    if (have.has('personal.phone')) break;
  }

  for (const l of lines) {
    if (l.length <= 90 && INSTITUTION.test(l) && !/@/.test(l)) {
      add({ key: 'academic.institution', value: l.replace(/^[•\-–*]\s*/, ''), evidence: l, confidence: 'medium' });
    }
    if (DEPARTMENT.test(l)) add({ key: 'academic.department', value: l, evidence: l, confidence: 'medium' });
    const deg = DEGREE.exec(l);
    if (deg && /education|university|institute|college|\bph|m\.?sc|b\.?tech|master|bachelor/i.test(l)) {
      add({ key: 'academic.degree', value: clean(deg[1]!), evidence: l, confidence: 'medium' });
    }
    const des = DESIGNATION.exec(l);
    if (des) add({ key: 'professional.designation', value: clean(des[1]!), evidence: l, confidence: 'medium' });
  }

  // research interests: "Research interests: a, b" or a heading followed by lines until the next section
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_INTERESTS.exec(lines[i]!);
    if (!m) continue;
    const body = [m[1]!];
    for (let j = i + 1; j < lines.length && body.join(' ').length < 300; j++) {
      if (SECTION_END.test(lines[j]!) || /^[A-Z][A-Za-z ]{2,25}:?$/.test(lines[j]!) && lines[j]!.split(' ').length <= 3) break;
      body.push(lines[j]!);
    }
    add({ key: 'research.research_interests', value: clean(body.join(' ')).slice(0, 300), evidence: lines[i]!, confidence: 'medium' });
    break;
  }

  return out;
}
