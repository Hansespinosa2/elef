const DESKTOP_FEATURE_FLAGS = Object.freeze({
  ELEF_ENABLE_REVISIONS: false,
  ELEF_ENABLE_LINEAGE: false
});
const featureName = (flag) => flag.replace(/^ELEF_ENABLE_/, "").toLowerCase();
function desktopFeatureEnabled(flag, flags = DESKTOP_FEATURE_FLAGS) {
  return flags[flag] === true;
}
function applyDesktopFeatureFlags(root = document, flags = DESKTOP_FEATURE_FLAGS) {
  const host = root.documentElement ?? root;
  for (const [flag, enabled] of Object.entries(flags)) {
    const name = featureName(flag);
    host.dataset[`elef${name.slice(0, 1).toUpperCase()}${name.slice(1)}Enabled`] = String(enabled === true);
  }
  for (const control of host.querySelectorAll("[data-desktop-feature]")) {
    const flag = `ELEF_ENABLE_${String(control.dataset.desktopFeature || "").toUpperCase()}`;
    const enabled = desktopFeatureEnabled(flag, flags);
    control.hidden = !enabled;
    control.setAttribute("aria-hidden", String(!enabled));
    if ("disabled" in control) control.disabled = !enabled;
  }
}
export {
  DESKTOP_FEATURE_FLAGS,
  applyDesktopFeatureFlags,
  desktopFeatureEnabled
};
