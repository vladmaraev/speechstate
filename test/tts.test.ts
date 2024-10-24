import { createActor, setup } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { waitForView, pause } from "./helpers";

describe("Synthesis test", async () => {
  const testMachine = setup({}).createMachine({
    context: ({ spawn }) => {
      return {
        ssRef: spawn(speechstate, {
          input: {
            azureRegion: "northeurope",
            azureCredentials: {
              endpoint:
                "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
              key: AZURE_KEY,
            },
          },
        }),
      };
    },
  });
  const actor = createActor(testMachine).start();
  actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });

  await waitForView(actor, "idle", 5000);
  actor
    .getSnapshot()
    .context.ssRef.getSnapshot()
    .context.ttsRef.subscribe((snapshot) =>
      console.log("[test.TTS state]", snapshot.value),
    );

  beforeEach(async () => {
    await waitForView(actor, "idle", 10000);
  });

  test("synthesise", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Hello, I speak with a default voice." },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise with voice setting", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "Hello! I am Emma.",
        voice: "en-US-EmmaMultilingualNeural",
      },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise, pause, speak again", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "Hello there!",
      },
    });
    await waitForView(actor, "speaking", 500);
    await pause(500);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    await waitForView(actor, "speaking-paused", 3000);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    const snapshot = await waitForView(actor, "idle", 3000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "", stream: "http://localhost:3000/sse/1" },
    });
    const snapshot = await waitForView(actor, "speaking", 1000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream, pause, speak again", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "", stream: "http://localhost:3000/sse/1" },
    });
    await waitForView(actor, "speaking", 500);
    await pause(2000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    await waitForView(actor, "speaking-paused", 3000);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    const snapshot = await waitForView(actor, "speaking", 1000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream with voice switch", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "", stream: "http://localhost:3000/sse/2" },
    });
    const snapshot = await waitForView(actor, "speaking", 1000);
    expect(snapshot).toBeTruthy();
  });
});
