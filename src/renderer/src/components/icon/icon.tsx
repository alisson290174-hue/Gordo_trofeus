import "./icon.scss";

const iconModules = import.meta.glob("../../assets/icons/system/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const ICON_URLS: Record<string, string> = {};
for (const path in iconModules) {
  const name = path.split("/").pop()!.replace(".png", "");
  ICON_URLS[name] = iconModules[path];
}

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

/**
 * Renders one of the custom system icons (src/renderer/src/assets/icons/system)
 * as a CSS-maskable glyph so it inherits color from `currentColor`, the same way
 * the achievement notification's trophy overlay already does.
 */
export function Icon({ name, size = 24, className }: Readonly<IconProps>) {
  const url = ICON_URLS[name];

  if (!url) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`Icon "${name}" not found in assets/icons/system`);
    }
    return null;
  }

  return (
    <span
      className={["icon", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
      }}
    />
  );
}
