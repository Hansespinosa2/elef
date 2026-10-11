// ElefHost over Tauri invoke against the desktop command surface.
// Transport policy: the library root is a single workspace ("local"); search
// is adapter-side substring filtering over document_graph plus work folder names;
// delete is dialog-mediated in production, so automation runs with
// deleteProgrammatic: false. Exported bytes come from the e2e harness export
// file; import takes archive bytes through import_elef_bytes.
import { createPortSession } from "@elef/client";

export const tauriPolicy = {
  deleteProgrammatic: false,
};

function commandError(error) {
  if (error && typeof error === "object" && "code" in error) return error;
  return { code: "internal", message: String(error), retryable: false };
}

export function createTauriHost({ invoke, readExportFile, initialStatus }) {
  const baseHashes = new Map();
  // Boot snapshot reuse: the host already fetched get_library_status at
  // boot, so the client's first list serves it instead of paying two more
  // full-list IPCs racing boot. Single-use: any mutation drops it and the
  // next list re-fetches, so a served list is never older than its fetch.
  let bootStatus = initialStatus ?? null;
  // Same-tick refresh note: refreshLibrary lists work folders through the raw
  // transport and hands the result over, so the client's reload in the same
  // refresh consumes it instead of listing a second time. Single-use.
  let notedWorkFolders = null;
  // The root name only changes via chooseLibrary, which invalidates this;
  // every other list serves the cached workspace without a status IPC.
  let cachedWorkspaces = null;
  // Latest listed summaries by work id. Snapshots join fresh preview text
  // onto the cached summary so getWork stays read-only: it must never call
  // open_work_folder, which repairs manifestless identities and would invalidate
  // the listed id the caller is holding.
  const summaries = new Map();

  function remember(workFolder) {
    const work = summary(workFolder);
    summaries.set(work.id, work);
    return work;
  }

  function summary(workFolder) {
    // WorkFolderSummary carries kind; OpenWorkFolder (create/open) does not, so derive it
    // from the kind-specific source file for those shapes.
    const kind =
      workFolder.kind ?? (workFolder.source_file === "presentation.md" ? "presentation" : "document");
    const modifiedMs = workFolder.modified_ms ?? workFolder.fingerprint?.modified_ms;
    return {
      id: String(workFolder.id),
      workspaceId: "local",
      title: workFolder.name,
      kind: kind === "presentation" ? "presentation" : "document",
      updatedAt:
        modifiedMs === null || modifiedMs === undefined
          ? new Date().toISOString()
          : new Date(Number(modifiedMs)).toISOString(),
      warnings: [...(workFolder.warnings ?? []), ...(workFolder.notices ?? [])].map(String),
    };
  }

  async function call(command, args, options) {
    // The wdio wrapper cannot rethrow across the WebDriver boundary with its
    // code intact, so it resolves command failures into an envelope the
    // adapter turns back into a rejection. Native invoke already rejects.
    const result = await invoke(command, args, options);
    if (result && typeof result === "object" && "__elefInvokeError" in result) {
      throw result.__elefInvokeError;
    }
    return result;
  }

  async function snapshotOf(workFolderId) {
    const snapshot = await call("read_source_snapshot", { id: workFolderId });
    let work = summaries.get(String(workFolderId));
    if (!work) {
      const workFolders = await call("list_work_folders");
      work = workFolders.map(summary).find(entry => entry.id === String(workFolderId)) ?? null;
    }
    if (!work) {
      throw { code: "not_found", message: "The Work could not be found.", retryable: false };
    }
    summaries.set(work.id, work);
    baseHashes.set(work.id, snapshot.content_hash);
    return {
      ...work,
      text: snapshot.source,
      baseline: { revision: String(snapshot.content_hash) },
    };
  }

  function workspaceOf(status) {
    return [{ id: "local", name: status?.root ? String(status.root) : "Local library" }];
  }

  function dropListCaches() {
    bootStatus = null;
    notedWorkFolders = null;
  }

  const library = {
    async listWorkspaces() {
      if (cachedWorkspaces) return cachedWorkspaces;
      // Read the boot snapshot without consuming it: listWorks consumes it
      // below, and the workspace cache means this path runs once per root.
      const status = bootStatus ?? (await call("get_library_status"));
      cachedWorkspaces = workspaceOf(status);
      return cachedWorkspaces;
    },
    async listWorks() {
      const noted = notedWorkFolders;
      notedWorkFolders = null;
      if (noted) {
        summaries.clear();
        return noted.map(remember);
      }
      const status = bootStatus;
      bootStatus = null;
      if (status?.work_folders) {
        summaries.clear();
        return status.work_folders.map(remember);
      }
      const workFolders = await call("list_work_folders");
      summaries.clear();
      return workFolders.map(remember);
    },
    async createWork(input) {
      dropListCaches();
      const workFolder = await call("create_work_folder", { name: input.title, kind: input.kind });
      baseHashes.set(workFolder.id, workFolder.content_hash);
      if (input.text !== undefined && input.text !== null) {
        await worksPort.saveWork(workFolder.id, input.text, {
          revision: String(workFolder.content_hash),
        });
      }
      const opened = await call("open_work_folder", { id: workFolder.id });
      baseHashes.set(opened.id, opened.content_hash);
      return remember(opened);
    },
    async renameWork(workId, title) {
      dropListCaches();
      const workFolder = await call("rename_work_folder", { id: workId, name: title });
      return remember(workFolder);
    },
    async deleteWork(workId) {
      dropListCaches();
      const result = await call("delete_work_folder", { id: workId });
      // The backend mediates deletion with a native Trash confirmation; a
      // dismissed dialog resolves instead of rejecting, so translate the
      // negative ack into the port-level cancellation the client swallows.
      if (result && result.deleted === false) {
        throw { code: "cancelled", message: "The deletion was cancelled.", retryable: false };
      }
      baseHashes.delete(workId);
      summaries.delete(String(workId));
    },
  };

  const worksPort = {
    async getWork(workId) {
      return snapshotOf(workId);
    },
    async saveWork(workId, text, baseline) {
      // A save bumps the work mtime, so the next list must re-fetch rather
      // than serve the noted work folders, or card keys would not turn over and
      // previews would stay stale after the save that changed them.
      dropListCaches();
      try {
        const result = await call("save_source", {
          id: workId,
          source: text,
          baseHash: baseline.revision,
        });
        baseHashes.set(workId, result.content_hash);
        return { kind: "saved", baseline: { revision: String(result.content_hash) } };
      } catch (error) {
        const failure = commandError(error);
        if (failure.code === "conflict") {
          const current = await snapshotOf(workId);
          return { kind: "conflict", current };
        }
        throw error;
      }
    },
  };

  const mediaPort = {
    async listMedia(workId) {
      const items = await call("list_media", { id: workId });
      return items.map((item) => ({
        id: String(item.digest),
        workId: String(workId),
        name: `${item.digest}.asset`,
        mimeType: item.content_type,
      }));
    },
    async addMedia(workId, input) {
      // Plain array: WebDriver JSON-serializes execute args, so the in-page
      // invoke wrapper rehydrates bytes into a Uint8Array for the raw body.
      const uploaded = await call("upload_asset", Array.from(input.bytes), {
        headers: {
          "x-elef-work-id": workId,
          "x-elef-filename": input.name,
          "x-elef-declared-media-type": input.mimeType,
          "x-elef-fit": "contain",
        },
      });
      return {
        id: String(uploaded.digest),
        workId: String(workId),
        name: input.name,
        mimeType: uploaded.content_type ?? input.mimeType,
      };
    },
    async removeMedia(mediaId) {
      const found = await findOwningWork(mediaId);
      await call("remove_media", { id: found, digest: mediaId });
    },
    async resolveMedia(mediaId) {
      const found = await findOwningWork(mediaId);
      const items = await call("list_media", { id: found });
      const match = items.find((item) => String(item.digest) === String(mediaId));
      if (!match) {
        throw commandError({ code: "not_found", message: "media not found", retryable: false });
      }
      return {
        id: String(mediaId),
        workId: String(found),
        name: `${mediaId}.asset`,
        mimeType: match.content_type,
        url: `elefasset://localhost/${encodeURIComponent(found)}/${encodeURIComponent(mediaId)}`,
      };
    },
  };

  async function findOwningWork(mediaId) {
    const workFolders = await call("list_work_folders");
    for (const workFolder of workFolders) {
      const items = await call("list_media", { id: workFolder.id });
      if (items.some((item) => String(item.digest) === String(mediaId))) return workFolder.id;
    }
    throw commandError({ code: "not_found", message: "media not found", retryable: false });
  }

  const settingsPort = {
    async getSettings() {
      return invoke("read_library_config");
    },
    async updateSettings(patch) {
      const current = await call("read_library_config");
      const merged = { ...current, ...patch };
      await call("write_library_config", { config: merged });
      return invoke("read_library_config");
    },
  };

  const searchPort = {
    async search(input) {
      const query = input.query.toLowerCase();
      const workFolders = await call("list_work_folders");
      const graph = await call("document_graph").catch(() => []);
      const sources = new Map(graph.map((doc) => [String(doc.id), doc.source ?? ""]));
      const hits = [];
      for (const workFolder of workFolders) {
        const summaryValue = summary(workFolder);
        const haystack = `${workFolder.name}\n${sources.get(String(workFolder.id)) ?? ""}`.toLowerCase();
        if (haystack.includes(query)) hits.push({ work: summaryValue });
      }
      return { requestId: input.requestId, hits };
    },
  };

  const transferPort = {
    async exportElef(workIds) {
      if (workIds.length !== 1) throw new Error("tauri export handles one Work per call");
      if (typeof readExportFile !== "function") {
        throw new Error("tauri export bytes require the e2e harness export file");
      }
      await call("export_elef", { id: workIds[0] });
      return readExportFile();
    },
    async importElef(bytes) {
      dropListCaches();
      try {
        const result = await call("import_elef_bytes", { bytes: Array.from(bytes) });
        if (!result) throw new Error("import produced no Work");
        if (result.name_collision) {
          const resolved = await call("resolve_import_conflict", { resolution: "keep_both" });
          if (!resolved) throw new Error("import conflict could not be resolved");
          return [summary(resolved.work_folder)];
        }
        return [summary(result.work_folder)];
      } catch (error) {
        if (error?.code !== "import_conflict") throw error;
        const resolved = await call("resolve_import_conflict", { resolution: "keep_both" });
        if (!resolved) throw new Error("import conflict could not be resolved");
        return [summary(resolved.work_folder)];
      }
    },
  };

  return {
    capabilities: {
      accounts: false,
      collaboration: false,
      entitlements: false,
      updater: true,
      nativeMenus: true,
      localFilesystem: true,
    },
    library,
    works: worksPort,
    media: mediaPort,
    settings: settingsPort,
    search: searchPort,
    transfer: transferPort,
    // Desktop-internal list coordination, not part of the ElefHost ports:
    // the application hands its same-tick list over so the client's reload
    // in the same refresh consumes it instead of listing twice.
    noteListedWorkFolders(workFolders) {
      notedWorkFolders = workFolders;
    },
    noteRootChanged() {
      cachedWorkspaces = null;
      dropListCaches();
    },
    async createWorkSession(workId) {
      return createPortSession(worksPort, workId);
    },
  };
}
