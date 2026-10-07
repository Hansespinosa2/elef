import type { HostCapabilities } from "./errors.js";
import type { WorkId } from "./ids.js";
import type {
  LibraryPort,
  MediaPort,
  SearchPort,
  SettingsPort,
  TransferPort,
  WorksPort,
} from "./ports.js";
import type { WorkSession } from "./session.js";

export interface ElefHost {
  capabilities: HostCapabilities;
  library: LibraryPort;
  works: WorksPort;
  media: MediaPort;
  settings: SettingsPort;
  search: SearchPort;
  transfer: TransferPort;
  createWorkSession(workId: WorkId): Promise<WorkSession>;
}

export declare function mountElef(
  hostElement: HTMLElement,
  host: ElefHost,
  options?: { initialUrl?: string },
): { unmount(): void };
