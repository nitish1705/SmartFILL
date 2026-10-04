import { describe, expect, it } from 'vitest';
import { matchFields, matchOption, normalizeIdentifier, normalizeText, type FieldInfo } from './index';

function field(over: Partial<FieldInfo['context']> & { type?: string; control?: FieldInfo['controlType'] } = {}, extra: Partial<FieldInfo> = {}): FieldInfo {
  const { type, control, ...context } = over;
  return {
    fieldId: 'f0',
    controlType: control ?? 'input',
    inputType: type ?? 'text',
    disabled: false,
    readOnly: false,
    hidden: false,
    hasValue: false,
    context: { pageTitle: 'Test', ...context },
    ...extra,
  };
}

const values: Record<string, string> = {
  'personal.first_name': 'Ada',
  'personal.last_name': 'Lovelace',
  'personal.email': 'ada@example.edu',
  'personal.phone': '+91 98765 43210',
  'personal.country': 'India',
  'academic.institution': 'IISc',
  'professional.organization': 'Acme',
};

const run = (f: FieldInfo, v = values) => matchFields([f], { values: v })[0]!;

describe('normalizer', () => {
  it('splits identifiers and expands abbreviations', () => {
    expect(normalizeIdentifier('authorFirstName')).toBe('author first name');
    expect(normalizeIdentifier('ctl00$txtEmail')).toBe('email');
    expect(normalizeText('fname')).toBe('first name');
    expect(normalizeText('Dept.')).toBe('department');
    expect(normalizeText('E-mail *')).toBe('email');
    expect(normalizeText('Please enter your Name of Institution')).toBe('institution');
    expect(normalizeText("Father's Name")).toBe('father name');
  });

  it('is idempotent', () => {
    for (const s of ['First Name *', 'e-mail', 'Dept', 'Affiliation / Institution', 'ctl00$txtFirstName']) {
      const once = normalizeText(s);
      expect(normalizeText(once)).toBe(once);
    }
  });
});

describe('matcher', () => {
  it('uses autocomplete as the strongest signal', () => {
    const r = run(field({ autocomplete: 'given-name', label: 'Zzz' }));
    expect(r).toMatchObject({ key: 'personal.first_name', decision: 'auto', layer: 'autocomplete' });
  });

  it('prefers the more specific synonym ("Last name" is not "Name")', () => {
    expect(run(field({ label: 'Last name' })).key).toBe('personal.last_name');
  });

  it('treats Institution / Affiliation / University as one concept', () => {
    for (const label of ['Institution', 'Affiliation', 'University']) {
      expect(run(field({ label })).key).toBe('academic.institution');
    }
  });

  it('asks when "Organization" is ambiguous', () => {
    const r = run(field({ label: 'Organization' }));
    expect(r.decision).toBe('ask');
    expect(r.candidates.map((c) => c.key)).toEqual(expect.arrayContaining(['academic.institution', 'professional.organization']));
  });

  it('leaves a field blank when the profile has no value', () => {
    const r = run(field({ label: 'ORCID iD' }));
    expect(r.key).toBe('research.orcid');
    expect(r.decision).toBe('skip');
    expect(r.value).toBeUndefined();
  });

  it('returns UNKNOWN for unrelated fields', () => {
    const r = run(field({ label: 'How did you hear about us?' }));
    expect(r.key).toBeNull();
    expect(r.decision).toBe('skip');
  });

  it('downgrades fields about someone else', () => {
    expect(run(field({ label: "Mother's Mobile", type: 'tel' })).decision).not.toBe('auto');
    expect(run(field({ label: 'Email', sectionHeading: 'Emergency contact' })).decision).not.toBe('auto');
  });

  it('does not treat a bare Name as full name next to first/last fields', () => {
    const rs = matchFields(
      [field({ label: 'First name' }), { ...field({ label: 'Name' }), fieldId: 'f1' }],
      { values: { ...values, 'personal.full_name': 'Ada Lovelace' } },
    );
    expect(rs[1]!.decision).not.toBe('auto');
  });

  it('does not overwrite an already-filled field', () => {
    expect(run(field({ label: 'Email' }, { hasValue: true })).decision).toBe('skip');
  });

  it('never fills when a type mismatch would put the wrong data in', () => {
    expect(run(field({ label: 'Institution', type: 'email' })).decision).toBe('skip');
  });

  it('only auto-fills selects with a matching option', () => {
    const options = [{ text: 'Select', value: '' }, { text: 'United States', value: 'US' }, { text: 'India', value: 'IN' }];
    const ok = run(field({ label: 'Country', control: 'select' }, { options, inputType: undefined }));
    expect(ok).toMatchObject({ decision: 'auto', value: 'IN' });
    const none = run(field({ label: 'Country', control: 'select' }, { options: options.slice(0, 2), inputType: undefined }));
    expect(none.decision).toBe('review');
    expect(none.value).toBeUndefined();
  });

  it('respects maxlength by dropping to review', () => {
    expect(run(field({ label: 'Email' }, { maxLength: 5 })).decision).toBe('review');
  });
});

describe('safety', () => {
  const sensitive = [
    field({ label: 'Password', type: 'password' }),
    field({ label: 'Card number' }),
    field({ label: 'CVV' }),
    field({ label: 'Enter OTP' }),
    field({ label: 'Aadhaar Number' }),
    field({ label: 'SSN' }),
    field({ name: 'cardNumber' }),
    field({ autocomplete: 'cc-number' }),
    field({ label: 'Cardholder Name' }),
  ];
  it.each(sensitive.map((f, i) => [i, f] as const))('blocks sensitive field #%i', (_i, f) => {
    const r = run(f, { ...values, 'personal.full_name': 'Ada Lovelace' });
    expect(r.decision).toBe('blocked');
    expect(r.value).toBeUndefined();
  });

  it('does not block postal PIN code', () => {
    const v = { ...values, 'personal.postal_code': '560001' };
    expect(run(field({ label: 'PIN Code', name: 'pin' }), v)).toMatchObject({ key: 'personal.postal_code', decision: 'auto' });
    expect(run(field({ label: 'ATM PIN' }), v).decision).toBe('blocked');
  });

  it('only the first author block is filled when several exist', () => {
    const rs = matchFields(
      [
        { ...field({ label: 'Email', type: 'email', authorIndex: 1 }), fieldId: 'a' },
        { ...field({ label: 'Email', type: 'email', authorIndex: 2 }), fieldId: 'b' },
      ],
      { values },
    );
    expect(rs.map((r) => r.decision)).toEqual(['auto', 'skip']);
  });
});

describe('option matching', () => {
  const countries = [{ text: 'Select', value: '' }, { text: 'USA', value: 'us' }, { text: 'Bharat', value: 'in' }];
  it('uses exact, alias and fuzzy matching and never picks the placeholder', () => {
    expect(matchOption('United States', countries)).toBe(1);
    expect(matchOption('India', countries)).toBe(2);
    expect(matchOption('Select', countries)).toBe(-1);
    expect(matchOption('Atlantis', countries)).toBe(-1);
    expect(matchOption('Karnatakaa', [{ text: 'Karnataka', value: 'ka' }])).toBe(0);
  });
});
