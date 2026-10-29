import { useEffect, useState } from "react";
import { COVER_RATIO_TOLERANCE } from "@renderer/helpers/platform-cover";
import "./cover-frame.scss";

const ratios = new Map<string, number>();

/** width ÷ height of a picture, measured once per session. */
export const useImageRatio = (url: string | null) => {
  const [ratio, setRatio] = useState<number | null>(
    url ? (ratios.get(url) ?? null) : null
  );
  useEffect(() => {
    if (!url) return;
    const known = ratios.get(url);
    if (known) {
      setRatio(known);
      return;
    }
    setRatio(null);
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (!image.naturalHeight) return;
      const value = image.naturalWidth / image.naturalHeight;
      ratios.set(url, value);
      if (alive) setRatio(value);
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return ratio;
};

/**
 * A cover inside a frame shaped like its console's case (the parent sets the frame's size). A
 * scan of that shape fills it; anything else (a cover from another region, a custom picture) is
 * shown whole over a blurred copy of itself — never cut.
 */
/** Art-backup scans on disk are up to 4000 px wide; covers ask for a copy sized for the screen. */
const sizedLocal = (url: string, width: number) =>
  url.startsWith("local:") && !url.includes("?") ? `${url}?w=${width}` : url;

export function CoverFrame({
  url: originalUrl,
  ratio,
  alt = "",
  onError,
  eager = false,
  width = 600,
}: Readonly<{
  url: string;
  /** The frame's width ÷ height. */
  ratio: number;
  alt?: string;
  onError?: () => void;
  /** Load right away (a strip that scrolls: lazy covers left grey tiles behind). */
  eager?: boolean;
  /** Pixel width asked for local covers. */
  width?: number;
}>) {
  const url = sizedLocal(originalUrl, width);
  const measured = useImageRatio(url);
  const fits =
    measured === null ||
    Math.abs(measured / ratio - 1) <= COVER_RATIO_TOLERANCE;

  if (fits) {
    return (
      <span className="cover-frame">
        <img
          className="cover-frame__fill"
          src={url}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={onError}
        />
      </span>
    );
  }

  return (
    <span className="cover-frame">
      <span
        className="cover-frame__blur"
        style={{ backgroundImage: `url("${url}")` }}
        aria-hidden="true"
      />
      <img
        className="cover-frame__whole"
        src={url}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onError={onError}
      />
    </span>
  );
}
