import { z } from 'zod';

// C0/C1 control characters, optionally keeping \n (SECURITY V3) — matching them is the point
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_AND_NEWLINE = /[\u0000-\u001F\u007F-\u009F]/g;

/** Length in Unicode code points (what users perceive closer than UTF-16 units). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** NFC-normalise, strip control chars, trim. */
export function cleanText(value: string, { keepNewlines = false } = {}): string {
  return value
    .normalize('NFC')
    .replace(keepNewlines ? CONTROL : CONTROL_AND_NEWLINE, '')
    .trim();
}

/** A user-supplied text field: cleaned, then length-checked in code points. */
export function textField(min: number, max: number, opts: { keepNewlines?: boolean } = {}) {
  return z
    .string()
    .transform((v) => cleanText(v, opts))
    .pipe(
      z
        .string()
        .refine((v) => codePointLength(v) >= min, { message: `Must be at least ${min} characters` })
        .refine((v) => codePointLength(v) <= max, { message: `Must be at most ${max} characters` }),
    );
}

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a #RRGGBB colour');
