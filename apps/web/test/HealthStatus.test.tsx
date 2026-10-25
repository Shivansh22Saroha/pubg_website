import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthStatus } from '@/components/HealthStatus';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<HealthStatus />', () => {
  it('calls /api/health and shows a healthy state', async () => {
    const fetchMock = mockFetch(200, { status: 'ok', db: 'ok', redis: 'ok', version: '0.1.0' });
    render(<HealthStatus />);
    expect(await screen.findByText('All systems go')).toBeTruthy();
    expect(screen.getByText('server v0.1.0')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows degraded when the server reports a dependency down (503)', async () => {
    mockFetch(503, { status: 'degraded', db: 'error', redis: 'ok', version: '0.1.0' });
    render(<HealthStatus />);
    expect(await screen.findByText('Degraded')).toBeTruthy();
    expect(screen.getAllByText('error')).toHaveLength(1);
  });

  it('shows unreachable when the API is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<HealthStatus />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('treats a malformed body as unreachable', async () => {
    mockFetch(200, { hello: 'world' });
    render(<HealthStatus />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });
});
