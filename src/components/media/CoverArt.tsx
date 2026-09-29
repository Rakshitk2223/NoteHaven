import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';

interface CoverArtProps {
  src?: string | null;
  title: string;
  /** Letter size for the tile (the grid and the detail hero differ). */
  letterClassName?: string;
  imgClassName?: string;
  lazy?: boolean;
}

/**
 * A cover over the gradient letter tile, for the grid and the detail hero alike:
 * a missing, loading, failed or 1px-blank image never leaves an empty box.
 * Render inside a `relative` sized container.
 */
export function CoverArt({ src, title, letterClassName = 'text-2xl', imgClassName, lazy }: CoverArtProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <>
      <span aria-hidden="true" className={cn('absolute inset-0 grid place-items-center bg-gradient-brand-soft font-extrabold text-primary', letterClassName)}>
        {initialsOf(title)}
      </span>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          onLoad={(e) => { if (e.currentTarget.naturalWidth < 2) setFailed(true); }}
          className={cn('relative h-full w-full object-cover', imgClassName)}
        />
      )}
    </>
  );
}
