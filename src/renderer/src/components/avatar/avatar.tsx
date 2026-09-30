import { useEffect, useState } from "react";
import cn from "classnames";
import { Icon } from "@renderer/components/icon/icon";

import "./avatar.scss";

export interface AvatarProps
  extends Omit<
    React.DetailedHTMLProps<
      React.ImgHTMLAttributes<HTMLImageElement>,
      HTMLImageElement
    >,
    "src"
  > {
  size: number;
  src?: string | null;
}

export function Avatar({ size, alt, src, className, ...props }: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  // Retry when the avatar URL changes (reused element in friend/profile lists).
  useEffect(() => {
    setHasError(false);
  }, [src]);

  return (
    <div className="profile-avatar" style={{ width: size, height: size }}>
      {src && !hasError ? (
        <img
          className={cn("profile-avatar__image", className)}
          alt={alt}
          src={src}
          width={size}
          height={size}
          {...props}
          onError={() => setHasError(true)}
        />
      ) : (
        <Icon name="person" size={size * 0.7} />
      )}
    </div>
  );
}
