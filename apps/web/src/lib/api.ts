import { HealthResponseSchema, type HealthResponse } from '@rotationlab/shared';

/**
 * Health lives at `/api/health`, outside the versioned `/api/v1` base. Both 200 (ok) and
 * 503 (degraded) carry a valid HealthResponse body.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', {
    credentials: 'include',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }
  return HealthResponseSchema.parse(await res.json());
}
