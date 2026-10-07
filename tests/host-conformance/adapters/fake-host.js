// In-memory ElefHost for the contract conformance suite.
// Implements the full contract including optimistic-concurrency conflicts,
// so the suite's conflict paths run deterministically without I/O.

let nextId = 1;

function id(prefix) {
  return `${prefix}-${nextId++}`;
}

function elefError(category, message, retryable = false) {
  return { category, message, retryable };
}

function notFound(what) {
  const error = new Error(`${what} not found`);
  error.elefError = elefError("not_found", `${what} not found`);
  throw error;
}

export const fakePolicy = {
  deleteProgrammatic: true,
};

export function createFakeHost() {
  const workspaces = [{ id: "ws-1", name: "Fake library" }];
  const works = new Map();
  const media = new Map();
  let settings = { theme: "dark", typography: "serif" };
  const sessions = new Set();

  function summary(work) {
    return { id: work.id, workspaceId: work.workspaceId, title: work.title, kind: work.kind };
  }

  function snapshot(work) {
    return { ...summary(work), text: work.text, baseline: { revision: work.revision } };
  }

  function notifyExternal(work) {
    for (const session of sessions) {
      if (session.workId === work.id && !session.disposed) {
        session.emitExternal(snapshot(work));
      }
    }
  }

  const library = {
    async listWorkspaces() {
      return workspaces.map((space) => ({ ...space }));
    },
    async listWorks(workspaceId) {
      return [...works.values()]
        .filter((work) => work.workspaceId === workspaceId)
        .map(summary);
    },
    async createWork(input) {
      if (!workspaces.some((space) => space.id === input.workspaceId)) notFound("workspace");
      const work = {
        id: id("work"),
        workspaceId: input.workspaceId,
        title: input.title,
        kind: input.kind,
        text: input.text ?? `# ${input.title}\n`,
        revision: id("rev"),
      };
      works.set(work.id, work);
      return summary(work);
    },
    async renameWork(workId, title) {
      const work = works.get(workId) ?? notFound("work");
      work.title = title;
      return summary(work);
    },
    async deleteWork(workId) {
      if (!works.delete(workId)) notFound("work");
      for (const [mediaId, item] of media) {
        if (item.workId === workId) media.delete(mediaId);
      }
    },
  };

  const worksPort = {
    async getWork(workId) {
      const work = works.get(workId) ?? notFound("work");
      return snapshot(work);
    },
    async saveWork(workId, text, baseline) {
      const work = works.get(workId) ?? notFound("work");
      if (baseline.revision !== work.revision) {
        return { kind: "conflict", current: snapshot(work) };
      }
      work.text = text;
      work.revision = id("rev");
      notifyExternal(work);
      return { kind: "saved", baseline: { revision: work.revision } };
    },
  };

  function createSession(workId) {
    const work = works.get(workId) ?? notFound("work");
    const session = {
      workId,
      kind: work.kind,
      disposed: false,
      text: work.text,
      revision: work.revision,
      status: { kind: "clean" },
      externalHandlers: new Set(),
      statusHandlers: new Set(),
      getText() {
        return this.text;
      },
      applyLocalChange(change) {
        this.text = this.text.slice(0, change.from) + change.insert + this.text.slice(change.to);
        this.setStatus({ kind: "dirty" });
      },
      replaceText(text) {
        this.text = text;
        this.setStatus({ kind: "dirty" });
      },
      onExternalChange(handler) {
        this.externalHandlers.add(handler);
        return () => this.externalHandlers.delete(handler);
      },
      onStatus(handler) {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
      },
      setStatus(status) {
        this.status = status;
        for (const handler of this.statusHandlers) handler(status);
      },
      emitExternal(snapshotValue) {
        for (const handler of this.externalHandlers) handler(snapshotValue);
      },
      async flush() {
        if (this.disposed) {
          return { kind: "failed", error: elefError("invalid_input", "session disposed") };
        }
        const live = works.get(this.workId) ?? notFound("work");
        if (this.text === live.text && this.revision === live.revision) {
          this.setStatus({ kind: "clean" });
          return { kind: "clean", baseline: { revision: live.revision } };
        }
        this.setStatus({ kind: "saving" });
        const result = await worksPort.saveWork(this.workId, this.text, {
          revision: this.revision,
        });
        if (result.kind === "saved") {
          this.revision = result.baseline.revision;
          this.setStatus({ kind: "clean" });
          return result;
        }
        if (result.kind === "conflict") {
          this.emitExternal(result.current);
          this.setStatus({ kind: "clean" });
          return result;
        }
        this.setStatus({ kind: "error", error: result.error });
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
      if (!works.has(workId)) notFound("work");
      return [...media.values()]
        .filter((item) => item.workId === workId)
        .map(({ id: mediaId, workId: owner, name, mimeType }) => ({
          id: mediaId,
          workId: owner,
          name,
          mimeType,
        }));
    },
    async addMedia(workId, input) {
      if (!works.has(workId)) notFound("work");
      const item = {
        id: id("media"),
        workId,
        name: input.name,
        mimeType: input.mimeType,
        bytes: input.bytes,
      };
      media.set(item.id, item);
      return { id: item.id, workId, name: item.name, mimeType: item.mimeType };
    },
    async removeMedia(mediaId) {
      if (!media.delete(mediaId)) notFound("media");
    },
    async resolveMedia(mediaId) {
      const item = media.get(mediaId) ?? notFound("media");
      return {
        id: item.id,
        workId: item.workId,
        name: item.name,
        mimeType: item.mimeType,
        url: `fake-media://${item.workId}/${item.id}`,
      };
    },
  };

  const settingsPort = {
    async getSettings() {
      return { ...settings };
    },
    async updateSettings(patch) {
      settings = { ...settings, ...patch };
      return { ...settings };
    },
  };

  const searchPort = {
    async search(input) {
      const query = input.query.toLowerCase();
      const hits = [...works.values()]
        .filter((work) => !input.workspaceId || work.workspaceId === input.workspaceId)
        .filter(
          (work) =>
            work.title.toLowerCase().includes(query) || work.text.toLowerCase().includes(query),
        )
        .map((work) => ({ work: summary(work) }));
      return { requestId: input.requestId, hits };
    },
  };

  const transferPort = {
    async exportElef(workIds) {
      const payload = workIds.map((workId) => {
        const work = works.get(workId) ?? notFound("work");
        return snapshot(work);
      });
      return new TextEncoder().encode(JSON.stringify({ fakeElef: 1, works: payload }));
    },
    async importElef(bytes, workspaceId) {
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (!payload || payload.fakeElef !== 1 || !Array.isArray(payload.works)) {
        throw new Error("not a fake .elef archive");
      }
      const restored = [];
      for (const item of payload.works) {
        const created = await library.createWork({
          workspaceId,
          title: item.title,
          kind: item.kind,
          text: item.text,
        });
        restored.push(created);
      }
      return restored;
    },
  };

  return {
    capabilities: {
      accounts: false,
      collaboration: false,
      entitlements: false,
      updater: false,
      nativeMenus: false,
      localFilesystem: false,
    },
    library,
    works: worksPort,
    media: mediaPort,
    settings: settingsPort,
    search: searchPort,
    transfer: transferPort,
    async createWorkSession(workId) {
      return createSession(workId);
    },
  };
}
