import { useEffect } from "react";
import type { RefObject } from "react";

const DESIGN_WIDTH = 1280;

// React-native equivalent of the Stimulus presentation-canvas controller:
// scales slide/page content to its container through the --slide-scale
// custom property. Both hosts ran that controller, so both get this hook.
export function useSlideScale(
  ref: RefObject<HTMLElement | null>,
  design: { readonly width?: number; readonly height?: number } = {},
): void {
  const width = design.width ?? DESIGN_WIDTH;
  const height = design.height;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const resize = (): void => {
      const scale =
        height === undefined
          ? element.clientWidth / width
          : Math.min(element.clientWidth / width, element.clientHeight / height);
      element.style.setProperty("--slide-scale", String(scale));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, width, height]);
}
