'use client';

import { CUSTOM_MAP_LIMITS, MAP_IDS, MAPS, type CustomMap, type MapId } from '@rotationlab/shared';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { MapThumb } from '@/components/rooms/bits';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { prepareMapImage, useDeleteCustomMap, useUploadCustomMap } from '@/lib/customMaps';
import { cn } from '@/lib/utils';

export type MapChoice = { kind: 'pubg'; mapId: MapId } | { kind: 'custom'; id: string };

/** a picked file, shrunk and ready to send, with a preview for the form */
interface Picked {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

const tile =
  'relative cursor-pointer overflow-hidden rounded-control border-2 transition-colors focus-within:ring-2 focus-within:ring-accent';

/**
 * New-board map choice (FEATURES F20, UI_UX_SPEC §3.5): the PUBG maps, the room's uploaded maps,
 * and — for owners / editors — "Upload map": pick an image (JPG / PNG / WebP ≤ 15 MB, shrunk in
 * the browser to ≤ 4096 px), name it, say how wide it is in metres (so the grid and measure are
 * right), upload. A new map is selected straight away.
 */
export function BoardMapPicker({
  roomId,
  customMaps,
  value,
  onChange,
  canUpload,
}: {
  roomId: string;
  customMaps: readonly CustomMap[];
  value: MapChoice;
  onChange: (c: MapChoice, name: string) => void;
  canUpload: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const remove = useDeleteCustomMap(roomId);
  const full = customMaps.length >= CUSTOM_MAP_LIMITS.perRoom;
  const groupName = useId();

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Map" className="grid grid-cols-3 gap-2">
        {MAP_IDS.map((id) => {
          const on = value.kind === 'pubg' && value.mapId === id;
          return (
            <label
              key={id}
              className={cn(tile, on ? 'border-accent' : 'border-transparent hover:border-border')}
            >
              <input
                type="radio"
                name={groupName}
                checked={on}
                onChange={() => {
                  onChange({ kind: 'pubg', mapId: id }, MAPS[id].name);
                }}
                className="sr-only"
              />
              <MapThumb mapId={id} className="aspect-square" />
              <span className="block bg-surface-2 py-1 text-center text-xs font-medium">
                {MAPS[id].name}
              </span>
            </label>
          );
        })}
        {customMaps.map((m) => {
          const on = value.kind === 'custom' && value.id === m.id;
          return (
            <label
              key={m.id}
              data-testid="custom-map-option"
              className={cn(tile, on ? 'border-accent' : 'border-transparent hover:border-border')}
            >
              <input
                type="radio"
                name={groupName}
                checked={on}
                onChange={() => {
                  onChange({ kind: 'custom', id: m.id }, m.name);
                }}
                className="sr-only"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL */}
              <img
                src={m.previewUrl}
                alt=""
                className="aspect-square w-full bg-surface-2 object-cover"
                crossOrigin="anonymous"
              />
              <span className="block truncate bg-surface-2 px-1 py-1 text-center text-xs font-medium">
                {m.name}
              </span>
              {canUpload && (
                <button
                  type="button"
                  aria-label={`Delete map ${m.name}`}
                  title="Delete this map"
                  onClick={(e) => {
                    e.preventDefault();
                    remove.mutate(m.id, {
                      onSuccess: () => {
                        toast(`${m.name} deleted`);
                        if (on) onChange({ kind: 'pubg', mapId: 'erangel' }, MAPS.erangel.name);
                      },
                      onError: (err) => {
                        toast.error(err instanceof ApiError ? err.message : 'Couldn’t delete it');
                      },
                    });
                  }}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-bg/80 text-text-muted hover:text-danger pointer-coarse:size-9"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </label>
          );
        })}
        {canUpload && !uploading && (
          <button
            type="button"
            data-testid="custom-map-upload-open"
            disabled={full}
            title={
              full ? `A room can have at most ${CUSTOM_MAP_LIMITS.perRoom} custom maps` : undefined
            }
            onClick={() => {
              setUploading(true);
            }}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed border-border text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-muted"
          >
            <ImagePlus className="size-5" aria-hidden />
            Upload map
          </button>
        )}
      </div>
      {uploading && (
        <UploadForm
          roomId={roomId}
          onCancel={() => {
            setUploading(false);
          }}
          onDone={(m) => {
            setUploading(false);
            onChange({ kind: 'custom', id: m.id }, m.name);
          }}
        />
      )}
    </div>
  );
}

function UploadForm({
  roomId,
  onCancel,
  onDone,
}: {
  roomId: string;
  onCancel: () => void;
  onDone: (m: CustomMap) => void;
}) {
  const upload = useUploadCustomMap(roomId);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState(String(CUSTOM_MAP_LIMITS.defaultWidthM));
  const ids = { file: useId(), name: useId(), width: useId() };

  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    },
    [picked],
  );

  const widthM = Number(width);
  const widthOk =
    /^\d+$/.test(width) &&
    widthM >= CUSTOM_MAP_LIMITS.widthMinM &&
    widthM <= CUSTOM_MAP_LIMITS.widthMaxM;
  const ready = picked && name.trim().length > 0 && widthOk && !upload.isPending;

  return (
    <div
      data-testid="custom-map-upload"
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-2/40 p-3"
    >
      <div className="flex items-start gap-3">
        <label
          htmlFor={ids.file}
          className="flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-control border border-dashed border-border bg-bg text-text-muted hover:border-accent"
        >
          {picked ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
            <img src={picked.previewUrl} alt="" className="size-full object-contain" />
          ) : reading ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="size-6" aria-hidden />
          )}
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={ids.file}>Map image</Label>
          <input
            id={ids.file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            data-testid="custom-map-file"
            className="text-xs text-text-muted file:mr-2 file:rounded-control file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-text"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError(null);
              setReading(true);
              prepareMapImage(file)
                .then(({ blob, width: w, height: h }) => {
                  setPicked({ blob, previewUrl: URL.createObjectURL(blob), width: w, height: h });
                  if (!name)
                    setName(
                      file.name
                        .replace(/\.[^.]+$/, '')
                        .replace(/[_-]+/g, ' ')
                        .trim()
                        .slice(0, CUSTOM_MAP_LIMITS.nameMax),
                    );
                })
                .catch((err: unknown) => {
                  setPicked(null);
                  setError(err instanceof Error ? err.message : 'Couldn’t read that image');
                })
                .finally(() => {
                  setReading(false);
                });
            }}
          />
          <p className="text-[11px] leading-snug text-text-muted">
            JPG, PNG or WebP up to 15 MB. Only this room can see it.
            {picked && ` ${picked.width}×${picked.height} px.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.name}>Map name</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={CUSTOM_MAP_LIMITS.nameMax}
            placeholder="e.g. Bermuda"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.width}>Width (m)</Label>
          <Input
            id={ids.width}
            inputMode="numeric"
            value={width}
            aria-describedby={`${ids.width}-hint`}
            aria-invalid={!widthOk}
            onChange={(e) => {
              setWidth(e.target.value.replace(/[^\d]/g, ''));
            }}
          />
        </div>
      </div>
      <p id={`${ids.width}-hint`} className="-mt-1 text-[11px] leading-snug text-text-muted">
        How far it is from the left edge to the right edge in the game (its longer side). Erangel is
        about 8 000 m. The grid and the measure tool use it; you can change it later.
      </p>

      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="custom-map-upload-submit"
          disabled={!ready}
          onClick={() => {
            if (!picked) return;
            upload.mutate(
              { file: picked.blob, name: name.trim(), widthM },
              {
                onSuccess: (m) => {
                  toast.success(`${m.name} uploaded`);
                  onDone(m);
                },
                onError: (err) => {
                  setError(err instanceof ApiError ? err.message : 'Upload failed — try again');
                },
              },
            );
          }}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Uploading…
            </>
          ) : (
            'Upload map'
          )}
        </Button>
      </div>
    </div>
  );
}
