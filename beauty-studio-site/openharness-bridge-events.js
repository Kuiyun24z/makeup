function shouldResolveOpenHarnessAssistant(event) {
  return (
    event?.type === "assistant_complete" &&
    typeof event.message === "string" &&
    event.message.trim().length > 0
  );
}

module.exports = {
  shouldResolveOpenHarnessAssistant,
};
