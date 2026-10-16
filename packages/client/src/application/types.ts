import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";
import type { AuthoringRegistryTransport } from "../features/settings/authoringRegistry.js";
import type { VimEditorBridge } from "../features/settings/VimSettings.js";

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

// Optional host contribution for the shared authoring dialog. The dialog UI
// and registry semantics live in the client; only persistence (plus the
// editor-registry reload and markdown example rendering) differs per host,
// so hosts inject their transport instead of the client branching on hosts.
export interface AuthoringSeam {
  readonly transport: AuthoringRegistryTransport;
  readonly renderExample?: (source: string) => string | Promise<string>;
  readonly reloadEditorRegistry?: () => Promise<void>;
  // Host-owned close navigation (one host revisits the settings page,
  // the other switches views): the dialog only reports the intent.
  readonly onClose?: () => void;
  // Host status feedback for saves (desktop statusbar): the dialog always
  // reports inside its own status region as well.
  readonly onSaved?: (message: string) => void;
}

// One runnable entry in the shared command palette. Hosts inject their own
// command list (native menu actions on desktop, navigation commands on web);
// the palette only renders, filters, and runs them — never host-name
// branching. Chord chips are preformatted display strings so hosts keep
// their per-host chord vocabulary in the shared registry.
export interface LibraryPaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly chord: string | null;
  run(): void;
}

// Optional host contribution for the shared command palette + quick-open.
// Present only on hosts that mount the palette; without it the client
// renders no palette surface at all. Quick-open searches the loaded library
// titles; opening a work reuses the standard navigate seam.
export interface LibraryPaletteSeam {
  readonly commands: readonly LibraryPaletteCommand[];
}

export type PaletteMode = "commands" | "search";

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
  readonly authoring?: AuthoringSeam;
  readonly palette?: LibraryPaletteSeam;
  // Optional host contribution for the shared workspace-defaults page. The
  // vim preferences persist per device on every host; hosts that embed an
  // editor beside the settings UI (desktop) pass a bridge so changes
  // live-sync into the open editor, exactly like the authoring seam's
  // reloadEditorRegistry. Hosts without an editor omit it.
  readonly vimEditorBridge?: VimEditorBridge | null;
  // Host status feedback for workspace-default saves (desktop statusbar),
  // mirroring AuthoringSeam.onSaved: the page always reports inside its own
  // notice region as well.
  readonly onSettingsSaved?: (settings: Record<string, unknown>) => void;
  // Host capability declaration for the document-graph panel slot. Hosts
  // without graph support (the Stable desktop profile) pass false and the
  // client omits the panel element entirely; default true keeps every
  // existing host unchanged. Never host-name branching: a capability flag.
  readonly graphEnabled?: boolean;
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
  // Host-to-client palette control: opens the shared palette in the given
  // mode. No-op without the palette seam; hosts own the key that calls it.
  openPalette(mode: PaletteMode): void;
  // Host-to-client control, mirroring the onLibraryEvent client-to-host
  // reports: the host owns view-level state (which tab is showing, which
  // notice is visible) while the client owns the pixels.
  notify(message: string | null, tone?: NoticeTone): void;
  setFilter(filter: LibraryFilter): void;
  unmount(): void;
}

export type { ElefHost, WorkSummary };
