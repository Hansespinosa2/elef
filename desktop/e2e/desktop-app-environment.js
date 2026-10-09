export function createDesktopAppEnvironment(env, isolatedDirectories) {
  return {
    ...env,
    HOME: isolatedDirectories.home,
    XDG_CONFIG_HOME: isolatedDirectories.config,
    XDG_DATA_HOME: isolatedDirectories.data,
    XDG_CACHE_HOME: isolatedDirectories.cache
  }
}
