import { useEffect, useState } from "react";
import { PersonIcon } from "@primer/octicons-react";
import cn from "classnames";

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
  // A src that 404s (deleted CDN file, stale local path) degrades to the
  // person icon instead of the browser's broken-image icon
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    setFailedSrc(null);
  }, [src]);

  const showImage = src && src !== failedSrc;

  return (
    <div className="profile-avatar" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          className={cn("profile-avatar__image", className)}
          alt={alt}
          src={src}
          width={size}
          height={size}
          onError={() => setFailedSrc(src)}
          {...props}
        />
      ) : (
        <PersonIcon size={size * 0.7} />
      )}
    </div>
  );
}
