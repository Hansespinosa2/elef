import type { JSX } from "react";

export interface SafeHtmlProps {
  readonly html: string;
  readonly sanitize: (html: string) => string;
  readonly className?: string;
}

// The single raw-HTML insertion boundary: renderer output reaches the DOM
// only through here, and only after the required sanitizer runs.
export function SafeHtml({ html, sanitize, className }: SafeHtmlProps): JSX.Element {
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
  );
}
