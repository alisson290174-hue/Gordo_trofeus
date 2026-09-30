import { useState } from "react";
import type { ImgHTMLAttributes, SyntheticEvent } from "react";

export interface ImgProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  /** Image to load. When it is empty or fails to load, {@link fallback} is shown instead. */
  src?: string | null;
  /** Bundled placeholder shown when {@link src} is empty or errors out. */
  fallback: string;
}

/**
 * A drop-in <img> that never shows the browser's broken-image glyph: if `src` is
 * missing or fails to load (e.g. a Steam CDN cover 404s, the VPS is unreachable),
 * it swaps to the bundled `fallback` asset.
 *
 * The failed URL is tracked so that changing `src` to a new value retries the load
 * (important for reused elements in lists), and a fallback that itself errors is not
 * retried in a loop.
 */
export function Img({ src, fallback, onError, ...props }: ImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const shouldUseFallback = !src || failedSrc === src;

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (src && failedSrc !== src) {
      setFailedSrc(src);
    }
    onError?.(event);
  };

  return (
    <img
      {...props}
      src={shouldUseFallback ? fallback : src}
      onError={shouldUseFallback ? undefined : handleError}
    />
  );
}
