'use client';

import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  forgotPassword,
  resendVerification,
  resetPassword,
  usePublicConfig,
  verifyEmail,
} from '@/lib/account';
import { ApiError } from '@/lib/api';

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong');

/** Reads `?token=` once and strips it from the address bar (and history) right away. */
function useLinkToken(): string | null {
  const [token] = useState(() => {
    if (typeof window === 'undefined') return null;
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) window.history.replaceState(null, '', window.location.pathname);
    return t;
  });
  return token;
}

function Disabled() {
  return (
    <p className="text-sm text-text-muted">
      Email isn’t set up on this server, so this link can’t be used.{' '}
      <Link href="/login" className="text-accent underline">
        Back to log in
      </Link>
    </p>
  );
}

/** `/verify-email?token=` (AUTH-7). */
export function VerifyEmail() {
  const config = usePublicConfig();
  const token = useLinkToken();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');
  const sent = useRef(false);
  useEffect(() => {
    if (!config.data?.emailEnabled || sent.current || !token) return;
    sent.current = true;
    verifyEmail(token).then(
      () => {
        setState('done');
      },
      (err: unknown) => {
        setError(message(err));
        setState('failed');
      },
    );
  }, [config.data, token]);
  if (config.data && !config.data.emailEnabled) return <Disabled />;
  const shown = token ? state : 'failed';
  const why = token ? error : 'This link is invalid or has expired';
  return (
    <div className="flex flex-col gap-4 text-center" role="status">
      {shown === 'working' && (
        <p className="flex items-center justify-center gap-2 text-text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Verifying…
        </p>
      )}
      {shown === 'done' && (
        <>
          <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
          <h1 className="font-display text-2xl font-bold">Email verified</h1>
          <Link href="/dashboard" className={buttonVariants()}>
            Continue
          </Link>
        </>
      )}
      {shown === 'failed' && (
        <>
          <h1 className="font-display text-2xl font-bold">Couldn’t verify</h1>
          <p className="text-sm text-text-muted">
            {why}. Log in and use “Resend” to get a new link.
          </p>
        </>
      )}
    </div>
  );
}

/** `/forgot-password`: always the same answer, whether or not the account exists. */
export function ForgotPassword() {
  const config = usePublicConfig();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (config.data && !config.data.emailEnabled) return <Disabled />;
  if (sent) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <h1 className="font-display text-2xl font-bold">Check your email</h1>
        <p className="text-sm text-text-muted">
          If an account exists for {email}, we sent a link to reset its password. It expires in 30
          minutes.
        </p>
        <Link href="/login" className="text-sm text-accent underline">
          Back to log in
        </Link>
      </div>
    );
  }
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        forgotPassword(email.trim())
          .then(() => {
            setSent(true);
          })
          .catch((err: unknown) => {
            toast.error(message(err));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <h1 className="font-display text-2xl font-bold">Reset your password</h1>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={!email.trim() || busy}>
        Send reset link
      </Button>
    </form>
  );
}

/** `/reset-password?token=`: a new password; every session ends. */
export function ResetPassword() {
  const config = usePublicConfig();
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (config.data && !config.data.emailEnabled) return <Disabled />;
  if (done) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <h1 className="font-display text-2xl font-bold">Password changed</h1>
        <p className="text-sm text-text-muted">
          You were logged out everywhere. Log in with your new password.
        </p>
        <Link href="/login" className={buttonVariants()}>
          Log in
        </Link>
      </div>
    );
  }
  if (!token) {
    return (
      <p className="text-sm text-text-muted">
        This link is invalid or has expired.{' '}
        <Link href="/forgot-password" className="text-accent underline">
          Request a new one
        </Link>
      </p>
    );
  }
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        resetPassword(token, password)
          .then(() => {
            setDone(true);
          })
          .catch((err: unknown) => {
            toast.error(message(err));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password-again">Confirm new password</Label>
        <Input
          id="new-password-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => {
            setAgain(e.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={password.length < 10 || password !== again || busy}>
        Set new password
      </Button>
    </form>
  );
}

/** Logged-in banner while the email is unverified (EMAIL_ENABLED only). */
export function VerifyBanner({ verified }: { verified: boolean }) {
  const config = usePublicConfig();
  const [sent, setSent] = useState(false);
  if (verified || !config.data?.emailEnabled) return null;
  return (
    <div
      className="flex items-center justify-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm"
      role="status"
    >
      <MailWarning className="size-4 text-warning" aria-hidden />
      Verify your email to secure your account.
      <Button
        size="sm"
        variant="ghost"
        disabled={sent}
        onClick={() => {
          resendVerification().then(
            () => {
              setSent(true);
              toast.success('Verification email sent');
            },
            (err: unknown) => {
              toast.error(message(err));
            },
          );
        }}
      >
        {sent ? 'Sent' : 'Resend'}
      </Button>
    </div>
  );
}

/** The login form's "Forgot password?" — a link only when email is set up. */
export function ForgotLink() {
  const config = usePublicConfig();
  if (!config.data?.emailEnabled) return null;
  return (
    <Link href="/forgot-password" className="text-xs text-accent hover:underline">
      Forgot password?
    </Link>
  );
}
