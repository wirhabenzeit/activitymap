'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  LoaderCircle,
  X,
} from 'lucide-react';
import type { Photo } from '~/server/db/schema';
import {
  orderedPhotos,
  photoVariant,
  type PhotoVariant,
} from '~/lib/photo-gallery';
import { useShallowStore } from '~/store';
import { cn } from '~/lib/utils';

export function PhotoImage({
  variant,
  alt,
  full = false,
}: {
  variant?: PhotoVariant;
  alt: string;
  full?: boolean;
}) {
  return (
    <PhotoImageState
      key={variant?.url ?? 'missing'}
      variant={variant}
      alt={alt}
      full={full}
    />
  );
}

function PhotoImageState({
  variant,
  alt,
  full,
}: {
  variant?: PhotoVariant;
  alt: string;
  full: boolean;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const unavailable = !variant || state === 'error';
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      aria-busy={!unavailable && state === 'loading'}
    >
      {unavailable ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-3 bg-white/10 text-current"
          role={full ? 'status' : undefined}
        >
          <ImageOff className="h-5 w-5" aria-hidden="true" />
          {full && (
            <>
              <p>Photo unavailable</p>
              <p className="text-sm text-white/70">
                Reconnect or retry to load this image.
              </p>
              {variant && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-white/40 px-5"
                  onClick={() => {
                    setAttempt((n) => n + 1);
                    setState('loading');
                  }}
                >
                  Retry
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {state === 'loading' && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-white/10"
              role={full ? 'status' : undefined}
            >
              <LoaderCircle
                className="h-5 w-5 motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="sr-only">Loading photo</span>
            </div>
          )}
          <Image
            key={attempt}
            src={variant.url}
            alt={alt}
            fill
            unoptimized
            loading={full ? 'eager' : 'lazy'}
            sizes={full ? '100vw' : '96px'}
            className={cn(
              full ? 'object-contain' : 'object-cover',
              state !== 'loaded' && 'opacity-0',
            )}
            onLoad={() => setState('loaded')}
            onError={() => setState('error')}
          />
        </>
      )}
    </div>
  );
}

interface PhotoLightboxProps {
  photos: Photo[];
  title: string;
  className?: string;
  /** A map preview can expose just its invoking thumbnail, keeping activity order. */
  thumbnailID?: string;
}

export function PhotoLightbox(props: PhotoLightboxProps) {
  const scope = useShallowStore((s) =>
    JSON.stringify([s.user?.id, s.isGuest, s.guestMode]),
  );
  // Remount media state synchronously when account or gallery ownership changes.
  const ownership = JSON.stringify(
    [
      ...new Set(props.photos.map((p) => `${p.athlete_id}:${p.activity_id}`)),
    ].sort(),
  );
  return <PhotoGallery key={`${scope}:${ownership}`} {...props} />;
}

function PhotoGallery({
  photos,
  title,
  className,
  thumbnailID,
}: PhotoLightboxProps) {
  const ordered = orderedPhotos(photos);
  const [currentID, setCurrentID] = useState<string | null>(null);
  const invokingButton = useRef<HTMLButtonElement | null>(null);
  const touchStart = useRef<{ x: number; y: number; pointerID: number } | null>(
    null,
  );
  const index = ordered.findIndex((p) => p.unique_id === currentID);
  const current = ordered[index];
  // Clear a deleted current identity without ever rendering its retained bytes.
  if (currentID !== null && !current) setCurrentID(null);
  const go = (delta: number) => {
    const next = ordered[index + delta];
    if (next) setCurrentID(next.unique_id);
  };
  if (!ordered.length) return null;
  return (
    <>
      <div
        className={cn(
          'flex h-11 flex-row items-center gap-2 overflow-x-auto',
          className,
        )}
      >
        {ordered
          .filter((p) => !thumbnailID || p.unique_id === thumbnailID)
          .map((p) => (
            <button
              type="button"
              key={p.unique_id}
              className="aspect-square h-full min-h-11 min-w-11 shrink-0 overflow-hidden rounded-md focus-visible:outline focus-visible:outline-2"
              aria-label={`View photo ${ordered.indexOf(p) + 1} of ${ordered.length}: ${p.caption?.trim() ? p.caption.trim() : title}`}
              onClick={(e) => {
                e.stopPropagation();
                invokingButton.current = e.currentTarget;
                setCurrentID(p.unique_id);
              }}
            >
              <PhotoImage variant={photoVariant(p, 'thumbnail')} alt="" />
            </button>
          ))}
      </div>
      <DialogPrimitive.Root
        open={!!current}
        onOpenChange={(open) => {
          if (!open) setCurrentID(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[81] flex h-dvh flex-col bg-black text-white outline-none"
            onClick={(e) => e.stopPropagation()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (invokingButton.current?.isConnected)
                invokingButton.current.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                go(e.key === 'ArrowRight' ? 1 : -1);
              }
            }}
          >
            <header className="flex shrink-0 items-center gap-3 pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]">
              <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 focus-visible:outline focus-visible:outline-2"
                aria-label="Close photo viewer"
              >
                <X aria-hidden="true" />
              </DialogPrimitive.Close>
            </header>
            <div
              className="min-h-0 flex-1 touch-pan-y px-[max(1rem,env(safe-area-inset-left))]"
              style={{ touchAction: 'pan-y pinch-zoom' }}
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch') return;
                if (!e.isPrimary) {
                  touchStart.current = null;
                  return;
                }
                if ((e.target as HTMLElement).closest('button')) return;
                touchStart.current = {
                  x: e.clientX,
                  y: e.clientY,
                  pointerID: e.pointerId,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                touchStart.current = null;
              }}
              onPointerUp={(e) => {
                const start = touchStart.current;
                touchStart.current = null;
                if (
                  start?.pointerID === e.pointerId &&
                  Math.abs(e.clientX - start.x) > 50 &&
                  Math.abs(e.clientX - start.x) >
                    Math.abs(e.clientY - start.y) * 1.5
                ) {
                  go(e.clientX < start.x ? 1 : -1);
                }
              }}
            >
              {current && (
                <PhotoImage
                  key={current.unique_id}
                  variant={photoVariant(current, 'full')}
                  alt={
                    current.caption?.trim()
                      ? current.caption.trim()
                      : `Photo ${index + 1} of ${ordered.length}`
                  }
                  full
                />
              )}
            </div>
            <footer className="shrink-0 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <div className="mx-auto flex max-w-3xl items-center justify-center gap-6">
                {ordered.length > 1 && (
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 disabled:opacity-30"
                    aria-label="Previous photo"
                    disabled={index <= 0}
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                )}
                <p
                  className="text-sm tabular-nums"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {index + 1} of {ordered.length}
                </p>
                {ordered.length > 1 && (
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 disabled:opacity-30"
                    aria-label="Next photo"
                    disabled={index >= ordered.length - 1}
                    onClick={() => go(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
              {current?.caption?.trim() && (
                <p className="mx-auto mt-3 max-h-[20dvh] max-w-3xl overflow-y-auto whitespace-pre-wrap break-words text-center text-sm text-white/85">
                  {current.caption.trim()}
                </p>
              )}
            </footer>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
