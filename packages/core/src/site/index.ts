import type { FieldInfo } from '../types';

/** FNV-1a, 32-bit, hex. Not cryptographic: it only has to be stable and compact. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const flat = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\[\]_.-]+/gu, ' ').trim();

/**
 * Stable per-site identity of a field: label + name + id + section (+ author block).
 * Raw name/id are kept (digits included) so `authors[1][email]` and `authors[2][email]` differ.
 */
export function fieldSignature(f: FieldInfo): string {
  const c = f.context;
  return fnv1a([flat(c.label ?? c.ariaLabel ?? c.placeholder), flat(c.name), flat(c.id), flat(c.sectionHeading), f.controlType].join('|'));
}
