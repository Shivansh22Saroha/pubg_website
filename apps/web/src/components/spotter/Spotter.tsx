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
            'bgmi-cut fixed z-[900] flex items-center gap-2 bg-accent font-display text-accent-fg uppercase shadow-[0_10px_30px_-10px_rgba(0,0,0,0.9)] transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px',
            onMap
              ? 'top-[76px] right-4 h-11 px-3 text-[19px] leading-none'
              : 'right-5 bottom-5 h-14 px-5 text-[22px] leading-none',
          )}
        >
          <SpotterIcon className={onMap ? 'size-5' : 'size-6'} />
          <span className={cn('pt-[3px]', onMap && 'max-sm:sr-only')}>
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
