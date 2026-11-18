import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as icons from '@/components/tools/icons';
import { TOOLS } from '@/components/tools/Toolbar';
import { Hint, HINT_LONG_PRESS_MS } from '@/components/ui/hint';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderHint(onClick = vi.fn()) {
  render(
    <Hint label="Circle" shortcut="C" description="Mark a zone">
      <button type="button" aria-label="Circle" onClick={onClick}>
        o
      </button>
    </Hint>,
  );
  return { onClick, button: screen.getByRole('button', { name: 'Circle' }) };
}

describe('tool hints (UI_UX_SPEC §3.5)', () => {
  it('every tool has its own icon, a shortcut and a one-line hint', () => {
    expect(TOOLS).toHaveLength(11);
    expect(new Set(TOOLS.map((t) => t.icon)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.key).toMatch(/^[A-Z]$/);
      expect(t.hint.length).toBeGreaterThan(8);
    }
    expect(Object.values(icons).length).toBeGreaterThanOrEqual(TOOLS.length);
  });

  it('keyboard focus shows the name, the shortcut and what it does', async () => {
    renderHint();
    act(() => {
      screen.getByRole('button', { name: 'Circle' }).focus();
    });
    const hint = await screen.findByTestId('hint');
    expect(hint.textContent).toContain('Circle');
    expect(hint.textContent).toContain('C');
    expect(hint.textContent).toContain('Mark a zone');
  });

  it('touch: holding the button shows the hint and that press does not trigger the button', () => {
    vi.useFakeTimers();
    const { onClick, button } = renderHint();
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(HINT_LONG_PRESS_MS + 10);
    });
    expect(screen.getByTestId('hint').textContent).toContain('Mark a zone');
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('touch: a quick tap still presses the button', () => {
    vi.useFakeTimers();
    const { onClick, button } = renderHint();
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hint')).toBeNull();
  });
});
