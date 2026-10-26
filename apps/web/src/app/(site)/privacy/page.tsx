import { PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalNotice, Section } from '../legal';

export const metadata: Metadata = { title: 'Privacy' };

/** Plain-language privacy notice based on SECURITY §7. TODO(phase0): legal review. */
export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-display text-3xl font-bold">Privacy</h1>
      <LegalNotice />
      <Section title="What we store">
        <p>
          <strong>Your account:</strong> email address, username, display name, in-game name
          (optional), avatar colour, and your password as an Argon2id hash — never the password
          itself.
        </p>
        <p>
          <strong>What you make:</strong> rooms, boards, layers, drawings, markers, snapshots and
          chat messages, plus which rooms you belong to and your role there.
        </p>
        <p>
          <strong>Sessions:</strong> for each login, the browser&apos;s user-agent string and a
          salted hash of your IP address (not the address itself), so you can see and end your
          sessions in Settings. Security-relevant actions (e.g. restoring a snapshot, deleting an
          account) are recorded in an audit log with the same hashed IP.
        </p>
        <p>
          We do not store payment details, precise location, contacts or anything from your game
          account.
        </p>
      </Section>
      <Section title="Cookies and trackers">
        <p>
          {PRODUCT_NAME} uses only the cookies it needs to keep you logged in: a short-lived access
          cookie and a refresh cookie, both httpOnly so page scripts can&apos;t read them. A few
          view preferences (e.g. map labels on or off) are kept in your browser&apos;s local storage
          and never leave your device.
        </p>
        <p>
          <strong>No trackers:</strong> no advertising, no third-party analytics, no tracking
          pixels. If we ever add analytics it will be cookie-less and listed here first.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p>
          Your account and content stay until you delete them. Expired or revoked sessions are
          deleted 30 days after they end, audit-log entries after 90 days, and a deleted room is
          permanently erased 7 days after it was deleted. Encrypted backups are kept for 14 days.
        </p>
      </Section>
      <Section title="Deleting your data">
        <p>
          You can delete your account at any time in{' '}
          <Link href="/settings" className="text-info underline">
            Settings
          </Link>
          . Rooms you own are handed to a member you choose (or deleted), every session is ended,
          and your account is anonymised straight away: email and username are replaced, and the
          chat messages you wrote stay in their rooms without your name. Backups roll off within 14
          days.
        </p>
      </Section>
      <Section title="Who can see what">
        <p>
          Rooms are private: only members see their boards and chat. The public demo boards at
          /explore are sample content and contain no user data.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Questions or a security issue? See our{' '}
          <a href="/.well-known/security.txt" className="text-info underline">
            security contact
          </a>
          .
        </p>
      </Section>
    </article>
  );
}
