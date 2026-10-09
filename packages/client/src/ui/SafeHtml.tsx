import { useEffect, useRef } from "react";
import type { JSX, RefObject } from "react";

export interface SafeHtmlProps {
  readonly html: string;
  readonly sanitize: (container: Element, html: string) => void;
  readonly className?: string;
}

// The single raw-HTML insertion boundary: renderer output reaches the DOM
// only through here, installed by the container sanitizer (never
// dangerouslySetInnerHTML, never unsanitized).
export function SafeHtml({ html, sanitize, className }: SafeHtmlProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const installed = useRef<string | null>(null);
  useEffect(() => {
    const container = (ref as RefObject<HTMLElement | null>).current;
    if (container === null || installed.current === html) return;
    installed.current = html;
    sanitize(container as unknown as Element, html);
  });
  return <div ref={ref} className={className} />;
}
