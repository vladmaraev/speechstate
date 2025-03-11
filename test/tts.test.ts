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
            azureRegion: "swedencentral",
            azureCredentials: {
              endpoint:
                "https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
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
    .context.ttsRef.subscribe((snapshot: any) =>
      console.log("[test.TTS state]", snapshot.value),
    );

  beforeEach(async () => {
    await waitForView(actor, "idle", 20_000);
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

  test("synthesise from stream; stop and restart on CONTROL", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "", stream: "http://localhost:3000/sse/1" },
    });
    await waitForView(actor, "speaking", 500);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    await waitForView(actor, "speaking-paused", 3000);
    await pause(3000);
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

  test("play audio, stop and restart on CONTROL", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "Imagine that I am playing some hard rock!",
        audioURL: "http://localhost:3000/audio/test.mp3",
      },
    });
    await waitForView(actor, "speaking", 2000);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    await waitForView(actor, "speaking-paused", 3000);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    const snapshot = await waitForView(actor, "speaking", 2000);
    expect(snapshot).toBeTruthy();
  });

  test("Fallback to TTS if audio is not available", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "Imagine that I am playing some hard rock!",
        audioURL: "http://localhost:3000/audio/broken.mp3",
      },
    });
    const snapshot = await waitForView(actor, "speaking", 2000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream, use cache", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "",
        stream: "http://localhost:3000/sse/1",
        cache: "https://tala-tts-service.azurewebsites.net/api/",
      },
    });
    const snapshot = await waitForView(actor, "speaking", 2000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream, use cache; stop and restart on CONTROL", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "",
        stream: "http://localhost:3000/sse/1",
        cache: "https://tala-tts-service.azurewebsites.net/api/",
      },
    });
    await waitForView(actor, "speaking", 1000);
    await pause(1000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    await waitForView(actor, "speaking-paused", 1000);
    await pause(3000);
    actor.getSnapshot().context.ssRef.send({ type: "CONTROL" });
    const snapshot = await waitForView(actor, "speaking", 1000);
    expect(snapshot).toBeTruthy();
  });

  test("synthesise from stream, go to idle state after timeout", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "", stream: "http://localhost:3000/sse/noend" },
    });
    await waitForView(actor, "speaking", 1000);
    const snapshot = await waitForView(actor, "idle", 15_000);
    expect(snapshot).toBeTruthy();
  });

  /** just for the reference (tests couldn't be run on mobile Safari) */
  test.skip("synthesise in chain, fails on mobile safari", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Hello." },
    });
    await waitForView(actor, "speaking", 500);
    await waitForView(actor, "idle", 5000);
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "And hello!" },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    expect(snapshot).toBeTruthy();
  });
});
