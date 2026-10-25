'use client';

import type { DependencyStatus, HealthResponse } from '@rotationlab/shared';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchHealth } from '@/lib/api';
import { cn } from '@/lib/utils';

type State =
  { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'unreachable' };

function Dot({ tone }: { tone: 'success' | 'danger' | 'muted' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 rounded-full',
        tone === 'success' && 'bg-success',
        tone === 'danger' && 'bg-danger',
        tone === 'muted' && 'bg-text-muted',
      )}
    />
  );
}

function Row({ label, status }: { label: string; status: DependencyStatus | 'unknown' }) {
  const tone = status === 'ok' ? 'success' : status === 'error' ? 'danger' : 'muted';
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-text-muted">{label}</span>
      <span className="flex items-center gap-2 font-mono text-xs font-medium">
        <Dot tone={tone} />
        {status}
      </span>
    </div>
  );
}

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback((signal?: AbortSignal) => {
    fetchHealth(signal)
      .then((health) => {
        setState({ kind: 'ready', health });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'unreachable' });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);

  const api: DependencyStatus | 'unknown' =
    state.kind === 'ready' ? 'ok' : state.kind === 'unreachable' ? 'error' : 'unknown';
  const db = state.kind === 'ready' ? state.health.db : 'unknown';
  const redis = state.kind === 'ready' ? state.health.redis : 'unknown';

  const summary =
    state.kind === 'loading'
      ? 'Checking…'
      : state.kind === 'unreachable'
        ? 'API unreachable'
        : state.health.status === 'ok'
          ? 'All systems go'
          : 'Degraded';

  return (
    <section
      aria-labelledby="health-heading"
      className="w-full rounded-panel border bg-surface p-6 shadow-panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="health-heading" className="section-label text-lg text-text">
          System status
        </h2>
        <span role="status" aria-live="polite" className="text-xs font-medium text-text-muted">
          {summary}
        </span>
      </div>
      <div className="divide-y">
        <Row label="API" status={api} />
        <Row label="Database" status={db} />
        <Row label="Redis" status={redis} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="font-mono text-xs text-text-muted">
          {state.kind === 'ready' ? `server v${state.health.version}` : 'server v—'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setState({ kind: 'loading' });
            load();
          }}
          disabled={state.kind === 'loading'}
        >
          <RefreshCw className="size-4" />
          Recheck
        </Button>
      </div>
    </section>
  );
}
