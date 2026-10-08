import type { ElefHost } from "@elef/contracts";

export type LibraryFilter = "all" | "documents" | "presentations";

export interface ElefMountOptions {
  readonly initialUrl?: string;
  readonly navigate?: (target: { readonly workId: string } | { readonly url: string }) => void;
  readonly sanitizeHtml?: (html: string) => string;
}

export interface ElefShell {
  refresh(): Promise<void>;
  unmount(): void;
}

export type { ElefHost };
