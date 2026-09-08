"use client";
import { useEffect, useState } from "react";

// True when the media query matches; false during SSR and the first client render.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 880px)");
