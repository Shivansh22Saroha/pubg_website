import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** SMTP via nodemailer (AUTH-7). Dev: Mailpit (`docker compose --profile email up -d`, :1025). */
export function createSmtpMailer(opts: {
  host: string;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
}): Mailer {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    ...(opts.user ? { auth: { user: opts.user, pass: opts.pass ?? '' } } : {}),
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: opts.from, ...mail });
    },
  };
}

/** Keeps mail in memory — tests read `sent`. */
export function createMemoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send(mail) {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}

/** HTML-escapes text placed in an email body (user-controlled values never become markup). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
