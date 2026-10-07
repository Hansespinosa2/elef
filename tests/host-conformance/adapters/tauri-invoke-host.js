// ElefHost over Tauri invoke against the desktop command surface.
// Transport policy: the library root is a single workspace ("local"); search
// is adapter-side substring filtering over document_graph plus deck names;
// delete is dialog-mediated in production, so automation runs with
// deleteProgrammatic: false. Exported bytes come from the e2e harness export
// file; import takes archive bytes through import_elef_bytes.

export const tauriPolicy = {
  deleteProgrammatic: false,
};

function commandError(error) {
  if (error && typeof error === "object" && "code" in error) return error;
  return { code: "internal", message: String(error), retryable: false };
}

export function createTauriHost({ invoke, readExportFile }) {
  const baseHashes = new Map();
  const sessions = new Set();

  function summary(deck) {
    // DeckSummary carries kind; OpenDeck (create/open) does not, so derive it
    // from the kind-specific source file for those shapes.
    const kind =
      deck.kind ?? (deck.source_file === "presentation.md" ? "presentation" : "document");
    return {
      id: String(deck.id),
      workspaceId: "local",
      title: deck.name,
      kind: kind === "presentation" ? "presentation" : "document",
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

  async function snapshotOf(deckId) {
    const snapshot = await call("read_source_snapshot", { id: deckId });
    const deck = await call("open_deck", { id: deckId });
    baseHashes.set(deck.id, deck.content_hash);
    return {
      ...summary(deck),
      text: snapshot.source,
      baseline: { revision: String(snapshot.content_hash) },
    };
  }

  const library = {
    async listWorkspaces() {
      const status = await call("get_library_status");
      return [{ id: "local", name: status?.root ? String(status.root) : "Local library" }];
    },
    async listWorks() {
      const decks = await call("list_decks");
      return decks.map(summary);
    },
    async createWork(input) {
      const deck = await call("create_deck", { name: input.title, kind: input.kind });
      baseHashes.set(deck.id, deck.content_hash);
      if (input.text !== undefined && input.text !== null) {
        await worksPort.saveWork(deck.id, input.text, {
          revision: String(deck.content_hash),
        });
      }
      const opened = await call("open_deck", { id: deck.id });
      baseHashes.set(opened.id, opened.content_hash);
      return summary(opened);
    },
    async renameWork(workId, title) {
      const deck = await call("rename_deck", { id: workId, name: title });
      return summary(deck);
    },
    async deleteWork(workId) {
      await call("delete_deck", { id: workId });
      baseHashes.delete(workId);
    },
  };

  const worksPort = {
    async getWork(workId) {
      return snapshotOf(workId);
    },
    async saveWork(workId, text, baseline) {
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

  function createSession(workId) {
    const session = {
      workId,
      kind: null,
      text: "",
      revision: null,
      ready: null,
      statusHandlers: new Set(),
      externalHandlers: new Set(),
      disposed: false,
      ensure() {
        if (!this.ready) {
          this.ready = snapshotOf(workId).then((snapshot) => {
            this.kind = snapshot.kind;
            this.text = snapshot.text;
            this.revision = snapshot.baseline.revision;
            return snapshot;
          });
        }
        return this.ready;
      },
      getText() {
        return this.text;
      },
      applyLocalChange(change) {
        this.text = this.text.slice(0, change.from) + change.insert + this.text.slice(change.to);
        this.emitStatus({ kind: "dirty" });
      },
      replaceText(text) {
        this.text = text;
        this.emitStatus({ kind: "dirty" });
      },
      onExternalChange(handler) {
        this.externalHandlers.add(handler);
        return () => this.externalHandlers.delete(handler);
      },
      onStatus(handler) {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
      },
      emitStatus(status) {
        for (const handler of this.statusHandlers) handler(status);
      },
      async flush() {
        if (this.disposed) {
          return { kind: "failed", error: { category: "invalid_input", message: "session disposed", retryable: false } };
        }
        await this.ensure();
        const live = await snapshotOf(workId);
        if (live.text === this.text && live.baseline.revision === this.revision) {
          return { kind: "clean", baseline: live.baseline };
        }
        this.emitStatus({ kind: "saving" });
        const result = await worksPort.saveWork(workId, this.text, { revision: this.revision });
        if (result.kind === "saved") {
          this.revision = result.baseline.revision;
          baseHashes.set(workId, this.revision);
          this.emitStatus({ kind: "clean" });
          return result;
        }
        for (const handler of this.externalHandlers) handler(result.current);
        this.emitStatus({ kind: "clean" });
        return result;
      },
      dispose() {
        this.disposed = true;
        sessions.delete(this);
      },
    };
    sessions.add(session);
    return session;
  }

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
          "x-elef-deck-id": workId,
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
    const decks = await call("list_decks");
    for (const deck of decks) {
      const items = await call("list_media", { id: deck.id });
      if (items.some((item) => String(item.digest) === String(mediaId))) return deck.id;
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
      const decks = await call("list_decks");
      const graph = await call("document_graph").catch(() => []);
      const sources = new Map(graph.map((doc) => [String(doc.id), doc.source ?? ""]));
      const hits = [];
      for (const deck of decks) {
        const summaryValue = summary(deck);
        const haystack = `${deck.name}\n${sources.get(String(deck.id)) ?? ""}`.toLowerCase();
        if (haystack.includes(query)) hits.push({ work: summaryValue });
      }
      return { requestId: input.requestId, hits };
    },
  };

  const transferPort = {
    async exportElef(workIds) {
      if (workIds.length !== 1) throw new Error("tauri export handles one deck per call");
      if (typeof readExportFile !== "function") {
        throw new Error("tauri export bytes require the e2e harness export file");
      }
      await call("export_elef", { id: workIds[0] });
      return readExportFile();
    },
    async importElef(bytes) {
      try {
        const result = await call("import_elef_bytes", { bytes: Array.from(bytes) });
        if (!result) throw new Error("import produced no deck");
        if (result.name_collision) {
          const resolved = await call("resolve_import_conflict", { resolution: "keep_both" });
          if (!resolved) throw new Error("import conflict could not be resolved");
          return [summary(resolved.deck)];
        }
        return [summary(result.deck)];
      } catch (error) {
        if (error?.code !== "import_conflict") throw error;
        const resolved = await call("resolve_import_conflict", { resolution: "keep_both" });
        if (!resolved) throw new Error("import conflict could not be resolved");
        return [summary(resolved.deck)];
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
    async createWorkSession(workId) {
      const session = createSession(workId);
      await session.ensure();
      return session;
    },
  };
}
