import { normalizeIdentifier, normalizeText } from '../normalize';
import type { FieldInfo } from '../types';

const SENSITIVE_PATTERN = new RegExp(
  [
    'passw(?:or)?d', 'passwd', 'pwd', 'passcode',
    '\\bcvv2?\\b', '\\bcvc\\b', '\\bcsc\\b',
    'card (?:number|no|num)', 'credit card', 'debit card', 'card holder', 'cardholder', 'name on card', 'expiry', 'expiration',
    '\\bcc (?:num|number|exp|csc|name|type)',
    '\\botp\\b', 'one time', 'verification code', 'security (?:question|answer|code)',
    'aadhaar', 'aadhar', '\\bpan\\b', '\\bssn\\b', 'social security', 'passport', 'driving licen[cs]e', 'national id',
    'bank account', 'account number', '\\biban\\b', '\\bifsc\\b', 'routing number', '\\bswift\\b',
    '\\bpin\\b(?! code)', '\\bmpin\\b',
  ].join('|'),
);

/** Returns a reason when the field must never be filled, otherwise null. */
export function sensitiveReason(f: FieldInfo): string | null {
  const c = f.context;
  if (f.inputType === 'password') return 'password field';
  const ac = (c.autocomplete ?? '').toLowerCase();
  if (/\bcc-|one-time-code|new-password|current-password/.test(ac)) return 'sensitive autocomplete token';
  // Each source is checked on its own so a bare name="pin" next to the
  // label "PIN Code" (postal) cannot be read as "pin" + " code".
  const sources = [
    normalizeText(c.label),
    normalizeText(c.ariaLabel),
    normalizeText(c.placeholder),
    normalizeText(c.nearbyText),
    normalizeIdentifier(c.name),
    normalizeIdentifier(c.id),
  ];
  const postalPin = sources.slice(0, 4).some((s) => /\bpin code\b/.test(s));
  for (const s of sources) {
    const m = SENSITIVE_PATTERN.exec(s);
    if (m && !(postalPin && m[0] === 'pin')) return `sensitive field (${m[0]})`;
  }
  return null;
}
