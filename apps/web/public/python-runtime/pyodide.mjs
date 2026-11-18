// Elef pinned Python runtime loader (v0.27.3-elef1)
export async function loadPyodide(options = {}) {
  if (typeof globalThis.__elefLoadFullPyodideWasm === "function") {
    return await globalThis.__elefLoadFullPyodideWasm(options)
  }
  if (typeof globalThis.__elefBuiltInPythonEngine === "function") {
    return {
      runtimeVersion: "0.27.3-elef1",
      indexURL: options.indexURL || "",
      executeElefPythonBlock: (code, theme) => globalThis.__elefBuiltInPythonEngine(code, theme)
    }
  }
  throw new Error("Python runtime engine is not initialized.")
}
