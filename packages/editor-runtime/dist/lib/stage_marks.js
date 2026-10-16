function markStage(stage) {
  try {
    performance?.mark?.(`elef:${stage}`);
  } catch {
  }
}
export {
  markStage
};
