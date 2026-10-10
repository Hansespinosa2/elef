export interface TitleSaveDeck {
  id: string
  name: string
}

export interface TitleSaveFlowOptions {
  getDeck(): TitleSaveDeck | null | undefined
  getTitle(): unknown
  renameDeck(deck: TitleSaveDeck, title: string): Promise<unknown>
  onRenamed?: (renamed: unknown, title: string) => void
  onState?: (state: string, details: { dirty: boolean; blocked: boolean }) => void
  onError?: (error: unknown) => void
  delay?: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export function createTitleSaveFlow({
  getDeck,
  getTitle,
  renameDeck,
  onRenamed = () => {},
  onState = () => {},
  onError = () => {},
  delay = 650,
  setTimer = setTimeout,
  clearTimer: clearTimerOption = clearTimeout
}: TitleSaveFlowOptions) {
  // Nullable handles clear as undefined: every host clearTimeout (and the
  // unit-test fakes) treats both as a no-op, exactly like before.
  const clearTimer = (timer: ReturnType<typeof setTimeout> | null): void => {
    clearTimerOption(timer ?? undefined)
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let worker: Promise<boolean> | null = null
  let dirty = false
  let blocked = false

  const title = (): string => String(getTitle() ?? "").trim()
  const hasChange = (): boolean => {
    const deck = getDeck()
    return Boolean(deck && title() !== deck.name)
  }
  const setState = (state: string): void => onState(state, { dirty: dirty || Boolean(worker), blocked })

  function schedule(wait: number = delay): void {
    if (!getDeck()) return
    if (!hasChange()) {
      dirty = false
      blocked = false
      setState("Saved")
      return
    }

    dirty = true
    blocked = false
    setState("Unsaved title")
    clearTimer(timer)
    timer = null
    if (worker) return
    timer = setTimer(() => {
      timer = null
      void flush()
    }, wait)
  }

  async function flush({ force = false }: { force?: boolean } = {}): Promise<boolean> {
    clearTimer(timer)
    timer = null
    if (worker) return worker
    if (!hasChange()) {
      dirty = false
      blocked = false
      setState("Saved")
      return true
    }
    if (blocked && !force) return false

    dirty = true
    worker = (async () => {
      while (hasChange()) {
        const deck = getDeck()
        const nextTitle = title()
        if (!deck || !nextTitle) {
          const error = Object.assign(new Error("A deck title cannot be empty."), {
            code: "invalid_input",
            retryable: false
          })
          blocked = true
          onError(error)
          setState("Title save blocked")
          return false
        }

        setState("Saving title…")
        try {
          const renamed = await renameDeck(deck, nextTitle)
          if (getDeck()?.id !== deck.id) return false
          onRenamed(renamed, nextTitle)
        } catch (error) {
          blocked = true
          onError(error)
          setState("Title save blocked")
          return false
        }
      }

      dirty = false
      blocked = false
      setState("Saved")
      return true
    })()

    try {
      return await worker
    } finally {
      worker = null
      if (hasChange()) {
        dirty = true
        if (!blocked) schedule(0)
      }
    }
  }

  return {
    noteChange: schedule,
    flush,
    isDirty: () => dirty || Boolean(worker) || hasChange(),
    isBlocked: () => blocked
  }
}
