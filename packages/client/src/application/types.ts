import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";

export type LibraryFilter = "all" | "documents" | "presentations";

export interface CardAction {
  readonly label: string;
  readonly href?: string;
  readonly run?: (work: WorkSummary) => void;
}

export interface ElefMountOptions {
  readonly initialUrl?: string;
  readonly navigate?: (target: { readonly workId: string } | { readonly url: string }) => void;
  readonly sanitizeHtml?: (html: string, context: { readonly kind: WorkKind }) => string;
  readonly resolveWorkUrl?: (work: WorkSummary) => string;
  readonly resolveLibraryUrl?: (filter: LibraryFilter) => string;
  readonly resolvePreviewUrl?: (work: WorkSummary) => string | null;
  readonly resolveMediaBaseUrl?: (work: WorkSummary) => string;
  readonly confirmDelete?: (work: WorkSummary) => boolean | Promise<boolean>;
  readonly presentWork?: (work: WorkSummary) => void;
  readonly cardNote?: (work: WorkSummary) => string | null;
  readonly extraCardActions?: (work: WorkSummary) => readonly CardAction[];
}

export interface ElefShell {
  refresh(): Promise<void>;
  unmount(): void;
}

export type { ElefHost, WorkSummary };
