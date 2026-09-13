import { getDominantColorFromImage } from "../helpers";
import { useEffect, useState } from "react";

const dominantColorCache = new Map<string, string | null>();

interface DominantColorState {
  imageUrl: string | null;
  color: string | null;
  isResolved: boolean;
}

/**
 * Exposes readiness for surfaces that must not paint their un-themed fallback
 * before image sampling settles. Existing callers can keep using the color-only
 * hook below.
 */
export function useDominantColorStatus(imageUrl: string | null) {
  const [state, setState] = useState<DominantColorState>(() => ({
    imageUrl,
    color: imageUrl ? (dominantColorCache.get(imageUrl) ?? null) : null,
    isResolved: !imageUrl || dominantColorCache.has(imageUrl),
  }));

  useEffect(() => {
    if (!imageUrl) {
      setState({ imageUrl: null, color: null, isResolved: true });
      return;
    }

    if (dominantColorCache.has(imageUrl)) {
      setState({
        imageUrl,
        color: dominantColorCache.get(imageUrl) ?? null,
        isResolved: true,
      });
      return;
    }

    let isMounted = true;
    setState({ imageUrl, color: null, isResolved: false });

    void getDominantColorFromImage(imageUrl).then((nextColor) => {
      dominantColorCache.set(imageUrl, nextColor);

      if (!isMounted) return;
      setState({ imageUrl, color: nextColor, isResolved: true });
    });

    return () => {
      isMounted = false;
    };
  }, [imageUrl]);

  if (state.imageUrl !== imageUrl) {
    return {
      dominantColor: null,
      isResolved: !imageUrl || dominantColorCache.has(imageUrl),
    };
  }

  return {
    dominantColor: state.color,
    isResolved: state.isResolved,
  };
}

export function useDominantColor(imageUrl: string | null) {
  return useDominantColorStatus(imageUrl).dominantColor;
}
