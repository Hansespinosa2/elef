function desktopMenuKeyAction(event) {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "k") return "focus-search";
  if (key === "enter" && !event.shiftKey && !event.altKey && !event.isComposing) return "start-presentation";
  return null;
}
export {
  desktopMenuKeyAction
};
