import { ATTRIBUTION_TEXT, BGMI_NOTICE, PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata } from 'next';
import { LegalNotice, Section } from '../legal';

export const metadata: Metadata = { title: 'Terms' };

/** Placeholder terms of use. TODO(phase0): legal review (and the PUBG content-policy check). */
export default function TermsPage() {
  return (
    <article>
      <h1 className="font-display text-3xl font-bold">Terms of use</h1>
      <LegalNotice />
      <Section title="The service">
        <p>
          {PRODUCT_NAME} is a free, early-access tool for planning BGMI / PUBG strategies with your
          squad. It is provided as is, without guarantees of availability, and features may change
          while it is in development.
        </p>
      </Section>
      <Section title="Your account and content">
        <p>
          Keep your password to yourself; you are responsible for what happens in your account. What
          you draw and write stays yours — you let us store and show it to the members of your rooms
          so the app can work.
        </p>
      </Section>
      <Section title="Fair use">
        <p>
          Don&apos;t use {PRODUCT_NAME} to harass people, share illegal content, cheat in ways that
          break a game&apos;s rules, or attack or overload the service. We may remove content or
          accounts that do.
        </p>
      </Section>
      <Section title="Map imagery">
        <p>{ATTRIBUTION_TEXT}</p>
        <p>{BGMI_NOTICE}</p>
      </Section>
      <Section title="Ending">
        <p>
          You can delete your account at any time in Settings. We will give notice in the app before
          shutting the service down.
        </p>
      </Section>
    </article>
  );
}
