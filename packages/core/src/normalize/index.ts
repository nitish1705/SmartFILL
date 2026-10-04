const ABBREVIATIONS: Record<string, string> = {
  fname: 'first name',
  lname: 'last name',
  inst: 'institution',
  univ: 'university',
  dept: 'department',
  org: 'organization',
  ph: 'phone',
  mob: 'mobile',
  desig: 'designation',
  addr: 'address',
  tel: 'telephone',
  zipcode: 'zip code',
};

const NOISE = new Set([
  'field', 'input', 'txt', 'tb', 'ctl', 'ctrl', 'control', 'frm', 'fld', 'edit', 'box', 'textbox', 'ddl', 'sel',
]);

const FILLER = /\b(?:please enter|please|enter|your|name of|the|required|optional)\b/g;

/** `authorFirstName` / `author_first-name` → `author first name` (for name/id attributes only). */
export function splitIdentifier(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.$[\]]+/g, ' ');
}

export function normalizeText(input: string | undefined | null): string {
  if (!input) return '';
  let s = input.toLowerCase();
  s = s.replace(/[’']s\b/g, '');
  s = s.replace(/\be[\s-]?mail\b/g, 'email');
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s
    .split(' ')
    .map((t) => ABBREVIATIONS[t] ?? t)
    .join(' ');
  s = s.replace(FILLER, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t) && !/^ctl\d+$/.test(t) && !/^\d+$/.test(t))
    .join(' ');
}

/** Normalizer for identifier-like attributes (name, id, autocomplete). */
export function normalizeIdentifier(input: string | undefined | null): string {
  return input ? normalizeText(splitIdentifier(input)) : '';
}

export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(' ') : [];
}
