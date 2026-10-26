/** RFC 9116 `Expires` is required; a rolling year from the request keeps it valid. */
export function securityTxt(contact: string, origin: string, now = new Date()): string {
  const expires = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${origin.replace(/\/$/, '')}/.well-known/security.txt`,
    '# We aim to fix reported issues within 90 days and ask you not to disclose them before',
    '# that (coordinated disclosure, SECURITY.md §13).',
    '',
  ].join('\n');
}
