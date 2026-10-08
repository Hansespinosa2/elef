import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";

export type { WorkKind };

export type LibraryFilter = "all" | "documents" | "presentations";

export interface CardAction {
  readonly label: string;
  readonly href?: string;
  readonly run?: (work: WorkSummary) => void;
  readonly children?: readonly CardAction[];
  readonly menuClass?: string;
}

export type LibraryOperation = "renamed" | "deleted" | "created";

export type NoticeTone = "info" | "warning" | "error";

export interface UpdaterStatus {
  readonly available: boolean;
  readonly version?: string;
}

// Optional host contribution for the shared updater affordance. Present only
// on hosts with an update mechanism; the client renders the affordance iff
// `capabilities.updater` is true and this seam is provided — never by host
// name. Install/restart stays in host menus; the client only surfaces
// availability and offers a re-check.
export interface UpdaterSeam {
  status(): Promise<UpdaterStatus>;
  checkForUpdate(): Promise<UpdaterStatus>;
}

export interface ElefMountOptions {
  readonly initialUrl?: string;
  readonly navigate?: (
    target: { readonly workId: string; readonly kind: WorkKind } | { readonly url: string },
  ) => void;
  readonly resolveWorkUrl?: (work: WorkSummary) => string;
  readonly resolveLibraryUrl?: (filter: LibraryFilter) => string;
  readonly resolvePreviewUrl?: (work: WorkSummary) => string | null;
  readonly resolveMediaBaseUrl?: (work: WorkSummary) => string;
  readonly confirmDelete?: (work: WorkSummary) => boolean | Promise<boolean>;
  readonly presentWork?: (work: WorkSummary) => void;
  readonly cardNote?: (work: WorkSummary) => string | null;
  readonly extraCardActions?: (work: WorkSummary) => readonly CardAction[];
  readonly operationNotice?: (operation: LibraryOperation, work: WorkSummary) => string | null;
  readonly updater?: UpdaterSeam;
  readonly onLibraryEvent?: (event: {
    readonly type: LibraryOperation;
    readonly work: WorkSummary;
    // Opaque host-defined refresh info. The deleted event carries whatever
    // the host adapter answered beyond the void contract (one adapter
    // answers recomputed card notes for orphaned forks); hosts ignore
    // shapes they do not recognize.
    readonly detail?: unknown;
  }) => void;
}

export interface ElefShell {
  refresh(): Promise<void>;
  // Host-to-client control, mirroring the onLibraryEvent client-to-host
  // reports: the host owns view-level state (which tab is showing, which
  // notice is visible) while the client owns the pixels.
  notify(message: string | null, tone?: NoticeTone): void;
  setFilter(filter: LibraryFilter): void;
  unmount(): void;
}

export type { ElefHost, WorkSummary };
