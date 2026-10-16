export const DESKTOP_FEATURE_FLAGS = Object.freeze({
  ELEF_ENABLE_REVISIONS: false,
  ELEF_ENABLE_LINEAGE: false
})

const featureName = (flag: string): string => flag.replace(/^ELEF_ENABLE_/, "").toLowerCase()

export function desktopFeatureEnabled(flag: string, flags: Record<string, boolean> = DESKTOP_FEATURE_FLAGS): boolean {
  return flags[flag] === true
}

export function applyDesktopFeatureFlags(
  root: Document | HTMLElement = document,
  flags: Record<string, boolean> = DESKTOP_FEATURE_FLAGS
): void {
  const host = (root as Document).documentElement ?? (root as HTMLElement)
  for (const [flag, enabled] of Object.entries(flags)) {
    const name = featureName(flag)
    host.dataset[`elef${name.slice(0, 1).toUpperCase()}${name.slice(1)}Enabled`] = String(enabled === true)
  }

  for (const control of host.querySelectorAll<HTMLElement>("[data-desktop-feature]")) {
    const flag = `ELEF_ENABLE_${String(control.dataset.desktopFeature || "").toUpperCase()}`
    const enabled = desktopFeatureEnabled(flag, flags)
    control.hidden = !enabled
    control.setAttribute("aria-hidden", String(!enabled))
    if ("disabled" in control) control.disabled = !enabled
  }
}
