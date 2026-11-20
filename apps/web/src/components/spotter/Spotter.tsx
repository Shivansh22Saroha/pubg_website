'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSpotter } from '@/stores/spotterStore';
import { SpotterIcon } from './SpotterIcon';

// the panel and its knowledge base load on first open, not with every page
const SpotterPanel = dynamic(() => import('./SpotterPanel').then((m) => m.SpotterPanel), {
  ssr: false,
});

/** pages that are a full-screen map: their bottom-right holds the minimap and zoom controls */
const MAP_PAGE = /^\/(explore|maps\/|s\/)/;

/**
 * Spotter — the built-in help bot, on every page. A floating launcher, except in the room
 * workspace, whose top bar has its own Spotter button (the map's corners are taken there).
 */
export function Spotter() {
  const pathname = usePathname();
  const open = useSpotter((s) => s.open);
  const setOpen = useSpotter((s) => s.setOpen);
  const inRoom = pathname.startsWith('/rooms/');
  const onMap = inRoom || MAP_PAGE.test(pathname);

  return (
    <>
      {!inRoom && (
        <button
          type="button"
          data-testid="spotter-launcher"
          aria-expanded={open}
          aria-controls="spotter-panel"
          onClick={() => {
            setOpen(!open);
          }}
          className={cn(
            'fixed z-[900] flex items-center gap-2 rounded-full bg-accent font-semibold text-accent-fg shadow-[0_12px_32px_-10px_var(--accent-glow),0_10px_30px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.3)] transition-[background-color,transform] duration-150 hover:bg-accent-hi active:translate-y-px',
            onMap
              ? 'top-[76px] right-4 h-11 px-4 text-sm'
              : 'right-5 bottom-5 h-12 px-5 text-[15px]',
          )}
        >
          <SpotterIcon className={onMap ? 'size-5' : 'size-6'} />
          <span className={cn(onMap && 'max-sm:sr-only')}>
            {open ? 'Close Spotter' : 'Ask Spotter'}
          </span>
        </button>
      )}
      {open && (
        <SpotterPanel
          placement={inRoom ? 'room' : onMap ? 'top' : 'bottom'}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
