import test from "node:test";
import assert from "node:assert/strict";
import { AssistantSpeedTracker } from "../extensions/tokometer/speedometer.ts";

const message = (timestamp: number) => ({ role: "assistant", timestamp, usage: { output: 100 } });

test("completed response timing does not leak into a later response without a start event", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start(message(1000), 1010);
  assert.equal(tracker.end(message(1000), 2010).speedometer?.tps, 100);
  assert.equal(tracker.end(message(4000), 6000).speedometer?.tps, 50);
});

test("reset discards interrupted stream state", () => {
  const tracker = new AssistantSpeedTracker();
  tracker.start(message(1000), 1000);
  tracker.update({ delta: "x".repeat(100) }, 2000);
  tracker.reset();
  assert.equal(tracker.end({ role: "assistant" }, 3000).speedometer, undefined);
  tracker.start(message(4000), 4000);
  assert.equal(tracker.update({ delta: "xxxx" }, 5000)?.tps, 1);
});
