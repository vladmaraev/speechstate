import { createActor, setup } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { waitForView, pause } from "./helpers";

describe("SpeechState test", async () => {
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
            newTokenInterval: 5_000,
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
    .context.ssRef.subscribe((snapshot) =>
      console.log("[test.SpeechState state]", snapshot.value),
    );

  beforeEach(async () => {
    await waitForView(actor, "idle", 10000);
  });

  test("recognise after new token", async () => {
    await pause(15_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
      // value: {
      //   utterance:
      //     "Hello, I speak a rather long sentence which contains many words, up to a paragraph perhaps. So please bear with me.",
      // },
    });
    const snapshot = await waitForView(actor, "listening", 500);
    expect(snapshot).toBeTruthy();
  });

  test("speak after new token", async () => {
    await pause(15_000);
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance:
          "Hello, I speak a rather long sentence which contains many words, up to a paragraph perhaps. So please bear with me.",
      },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    expect(snapshot).toBeTruthy();
  });

  test.only("speak during getting a new token, then speak with a new token", async () => {
    await pause(4_000);
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "Hello, I can speak for a few seconds.",
      },
    });
    await waitForView(actor, "speaking", 500);
    await waitForView(actor, "idle", 8000);
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: "And with a new token!",
      },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    expect(snapshot).toBeTruthy();
  });
});
