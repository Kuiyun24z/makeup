const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldResolveOpenHarnessAssistant,
} = require("./openharness-bridge-events");

test("empty assistant completion before a tool call does not resolve the request", () => {
  assert.equal(
    shouldResolveOpenHarnessAssistant({
      type: "assistant_complete",
      message: "",
    }),
    false
  );
});

test("non-empty final assistant completion resolves the request", () => {
  assert.equal(
    shouldResolveOpenHarnessAssistant({
      type: "assistant_complete",
      message: "我看过啦，你的脸型线条很柔和。",
    }),
    true
  );
});
