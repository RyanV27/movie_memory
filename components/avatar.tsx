"use client";

import { useEffect, useRef, useState } from "react";

export function Avatar({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Catch an image that failed before hydration attached onError.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) {
    return (
      <svg
        role="img"
        aria-label={alt}
        viewBox="0 0 96 96"
        width={96}
        height={96}
        className="rounded-full bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
      >
        <circle cx="48" cy="36" r="16" fill="currentColor" />
        <path d="M16 90c0-18 14-30 32-30s32 12 32 30z" fill="currentColor" />
      </svg>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      width={96}
      height={96}
      referrerPolicy="no-referrer"
      className="rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
