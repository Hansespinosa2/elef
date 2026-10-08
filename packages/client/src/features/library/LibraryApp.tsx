import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { ElefHost, WorkSummary } from "@elef/contracts";
import type { ElefMountOptions, LibraryFilter } from "../../application/types.js";

export interface LibraryAppProps {
  readonly host: ElefHost;
  readonly initialFilter: LibraryFilter;
  readonly options: ElefMountOptions;
}

interface LibraryState {
  readonly works: readonly WorkSummary[];
  readonly filter: LibraryFilter;
  readonly ready: boolean;
}

// Step-1 skeleton: lists every work across workspaces through the ports.
// Search/filter/create/open/rename/delete arrive in step 3.
export function LibraryApp({ host, initialFilter, options }: LibraryAppProps): JSX.Element {
  const [state, setState] = useState<LibraryState>({ works: [], filter: initialFilter, ready: false });

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const spaces = await host.library.listWorkspaces();
      const works: WorkSummary[] = [];
      for (const space of spaces) {
        works.push(...(await host.library.listWorks(space.id)));
      }
      if (!cancelled) setState({ works, filter: initialFilter, ready: true });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [host, initialFilter]);

  const filter = state.filter;
  const kind = filter === "documents" ? "document" : filter === "presentations" ? "presentation" : null;
  const visible =
    kind === null ? state.works : state.works.filter((work) => work.kind === kind);
  const navigate = options.navigate;

  return (
    <div className="library-shared-view">
      <h1 id="library-title">Library</h1>
      <p role="status">
        {state.ready ? `Library ready (${visible.length} works)` : "Loading…"}
      </p>
      <ul>
        {visible.map((work) => (
          <li key={work.id} data-work-id={work.id}>
            <button
              type="button"
              onClick={() => navigate?.({ workId: work.id })}
            >{`${work.title} (${work.kind})`}</button>
          </li>
        ))}
      </ul>
      {host.capabilities.updater === true ? (
        <button type="button" data-elef-updates="true">
          Check for updates
        </button>
      ) : null}
    </div>
  );
}
