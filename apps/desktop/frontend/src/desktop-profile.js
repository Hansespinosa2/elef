// Profile inputs for the shared application: the desktop build defines
// __ELEF_DESKTOP_PROFILE__ per output, and Stable disables the excluded
// capabilities while Dev keeps the full surface.
export const desktopProfile = __ELEF_DESKTOP_PROFILE__

const devEnabled = desktopProfile !== "stable"

export const desktopFeatures = Object.freeze({
  visualEditing: devEnabled,
  presentationEditing: devEnabled,
  slideOverview: devEnabled,
  documentGraph: devEnabled,
  documentLinks: devEnabled
})

export const desktopFeatureFlags = Object.freeze({
  ELEF_ENABLE_REVISIONS: devEnabled,
  ELEF_ENABLE_LINEAGE: devEnabled
})
