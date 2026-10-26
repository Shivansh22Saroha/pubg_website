'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toLatLng } from '@/lib/coords';
import { laserAlpha, useLaserStore } from '@/stores/laserStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { safeColor } from './markerDom';

/**
 * Laser trails (FEATURES F6, Laser K): one canvas over the map, redrawn every frame while any
 * trail is alive — each segment fades out over 1.5 s, in the sender's presence colour. Pure
 * overlay: never interactive, never persisted.
 */
export function LaserLayer({ meId }: { meId: string }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement('canvas');
    canvas.className = 'rl-laser';
    canvas.dataset.testid = 'laser-canvas';
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '645',
    });
    container.append(canvas);
    const ctx = canvas.getContext('2d');
    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = container;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      frame = 0;
      if (!ctx) return;
      const now = Date.now();
      useLaserStore.getState().prune(now);
      const { trails } = useLaserStore.getState();
      const users = usePresenceStore.getState().users;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let alive = false;
      for (const [userId, points] of Object.entries(trails)) {
        const color = safeColor(users[userId === meId ? meId : userId]?.color, '#F43F5E');
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        let prev: { x: number; y: number } | null = null;
        for (const p of points) {
          const a = laserAlpha(p, now);
          if (a <= 0) continue;
          alive = true;
          const pt = map.latLngToContainerPoint(toLatLng([p.x, p.y]));
          if (prev) {
            ctx.globalAlpha = a;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
          }
          prev = pt;
        }
        // a glowing head at the newest point
        if (prev) {
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(prev.x, prev.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (alive) frame = requestAnimationFrame(draw);
    };
    const kick = () => {
      frame ||= requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      kick();
    });
    ro.observe(container);
    const off = useLaserStore.subscribe(kick);
    // expiry doesn't depend on frames being drawn (a busy or backgrounded tab)
    const prune = setInterval(() => {
      useLaserStore.getState().prune();
    }, 300);
    map.on('move zoom', kick);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(prune);
      ro.disconnect();
      off();
      map.off('move zoom', kick);
      canvas.remove();
    };
  }, [map, meId]);

  return null;
}
