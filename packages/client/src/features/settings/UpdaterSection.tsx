import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { UpdaterSeam, UpdaterStatus } from "../../application/types.js";

// Capability-gated update availability. Hosts with an update mechanism pass
// their seam (desktop); hosts without one render nothing here — the client
// never branches on host identity. Install/restart stays in host menus;
// this only surfaces availability and offers a re-check.
export function UpdaterSection({ seam }: { readonly seam: UpdaterSeam }): JSX.Element {
  const [status, setStatus] = useState<UpdaterStatus | null>(null);

  useEffect(() => {
    let live = true;
    // The updater endpoint can take seconds; resolve in the background.
    void seam
      .status()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => {
        if (live) setStatus(null);
      });
    return () => {
      live = false;
    };
  }, [seam]);

  async function recheck(): Promise<void> {
    try {
      setStatus(await seam.checkForUpdate());
    } catch {
      setStatus(null);
    }
  }

  return (
    <section aria-label="Updates" className="settings-card max-w-2xl rounded-2xl border p-6 mb-8">
      <h2 className="text-xl font-bold">Updates</h2>
      <p className="text-sm">
        {status === null
          ? "Update status is unavailable."
          : status.available
            ? `An update is available${status.version ? ` (${status.version})` : ""}.`
            : "This copy is up to date."}
      </p>
      <button type="button" onClick={() => void recheck()} className="button">
        Check for updates
      </button>
    </section>
  );
}
