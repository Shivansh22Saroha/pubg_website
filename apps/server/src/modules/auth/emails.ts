import { PRODUCT_NAME } from '@rotationlab/shared';
import { escapeHtml, type Mail } from '../../lib/mailer.js';

/**
 * Plain text + simple HTML (AUTH-7). The only user-controlled value is the display name, and it
 * is escaped; the link is ours (APP_ORIGIN + a base64url token). No remote images, no scripts.
 */
function layout(title: string, lines: string[], link: string, cta: string) {
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0b0f14;color:#e2e8f0;padding:24px">
<h1 style="font-size:20px;color:#f2a900">${escapeHtml(title)}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#f2a900;color:#0b0f14;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(cta)}</a></p>
<p style="font-size:12px;color:#94a3b8">${escapeHtml(link)}</p>
</body></html>`;
  return { text: [title, '', ...lines, '', `${cta}: ${link}`].join('\n'), html };
}

export function verifyEmailMail(to: string, displayName: string, link: string): Mail {
  return {
    to,
    subject: `Verify your email for ${PRODUCT_NAME}`,
    ...layout(
      `Welcome, ${displayName}!`,
      [
        `Confirm this address for your ${PRODUCT_NAME} account. The link works once and expires in 24 hours.`,
        'If you didn’t create an account, ignore this email.',
      ],
      link,
      'Verify email',
    ),
  };
}

export function resetPasswordMail(to: string, displayName: string, link: string): Mail {
  return {
    to,
    subject: `Reset your ${PRODUCT_NAME} password`,
    ...layout(
      `Hi ${displayName},`,
      [
        'Someone asked to reset your password. The link works once and expires in 30 minutes.',
        'Resetting logs you out everywhere. If it wasn’t you, ignore this email — your password stays the same.',
      ],
      link,
      'Choose a new password',
    ),
  };
}
