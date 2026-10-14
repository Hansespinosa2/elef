function installEditorRuntimeErrorHook(application) {
  if (!(typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__)) return;
  const handleError = application.handleError.bind(application);
  application.handleError = (error, message, detail) => {
    globalThis.__elefE2EControllerErrors ||= [];
    globalThis.__elefE2EControllerErrors.push({
      message: String(message),
      identifier: detail?.identifier || "",
      elementId: detail?.element?.id || "",
      errorName: error?.name || "",
      errorMessage: error?.message || String(error),
      causeName: error?.cause?.name || "",
      causeMessage: error?.cause?.message || "",
      errorStack: error?.stack || "",
      causeStack: error?.cause?.stack || ""
    });
    handleError(error, message, detail);
  };
}
export {
  installEditorRuntimeErrorHook
};
