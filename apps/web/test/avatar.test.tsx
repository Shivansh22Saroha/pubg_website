import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from '@/components/auth/UserMenu';

/** Profile photos (FEATURES F23): photo when set, initials on the colour otherwise or on error. */
afterEach(cleanup);

const user = { displayName: 'mortal', avatarColor: '#38BDF8' };

describe('Avatar', () => {
  it('shows the initial on the avatar colour without a photo', () => {
    const { container } = render(<Avatar user={{ ...user, avatarUrl: null }} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe('M');
    expect(el.style.backgroundColor).toBe('rgb(56, 189, 248)');
    expect(el.querySelector('img')).toBeNull();
  });

  it('shows the photo, and falls back to the initial when it fails to load', () => {
    const url = '/api/v1/assets/avatars/x/y.webp?exp=1&sig=z';
    const { container, rerender } = render(<Avatar user={{ ...user, avatarUrl: url }} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(url);
    expect(img.getAttribute('alt')).toBe('');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('M');
    // a new URL (a fresh signature, a new photo) is tried again
    rerender(<Avatar user={{ ...user, avatarUrl: `${url}2` }} />);
    expect(container.querySelector('img')).not.toBeNull();
  });
});
