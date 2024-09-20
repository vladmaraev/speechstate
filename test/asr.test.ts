import { createActor, setup, waitFor, assign } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { waitForView } from "./helpers";
import { SpeechStateExternalEvent } from "../src/types";

describe("Recognition test", async () => {
  const testMachine = setup({
    types: {} as {
      events: SpeechStateExternalEvent | { type: "CLEAR" };
    },
    actions: {
      assign_result: assign(({ event }) => {
        return { result: (event as any).value[0].utterance };
      }),
      assign_result_null: assign({ result: null }),
      remove_result: assign({ result: undefined }),
    },
  }).createMachine({
    context: ({ spawn }) => {
      return {
        result: undefined,
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
    on: {
      RECOGNISED: { actions: { type: "assign_result" } },
      ASR_NOINPUT: { actions: { type: "assign_result_null" } },
      CLEAR: { actions: { type: "remove_result" } },
    },
  });
  const actor = createActor(testMachine).start();
  actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });
  await waitForView(actor, "idle", 5000);

  /** That's how much we need to wait between ASR attempts  */
  beforeEach(async () => {
    actor.send({ type: "CLEAR" });
    await waitForView(actor, "idle", 5000);
  });

  test.skip("start recognising", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
    });
    const snapshot = await waitForView(actor, "recognising", 250);
    expect(snapshot).toBeTruthy();
  });

  test("get some result", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Say hey" },
    });
    await waitForView(actor, "speaking", 1_000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
    });
    await waitForView(actor, "idle", 10_000);
    const snapshot = await waitFor(
      actor,
      (snapshot) => {
        return !!snapshot.context.result;
      },
      {
        timeout: 5_000,
      },
    );
    expect(snapshot).toBeTruthy();
  });

  test("get some result in Swedish", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Say hey", voice: "sv-SE-SofieNeural" },
    });
    await waitForView(actor, "speaking", 1_000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
      value: { locale: "sv-SE" },
    });
    await waitForView(actor, "idle", 10_000);
    const snapshot = await waitFor(
      actor,
      (snapshot) => {
        return !!snapshot.context.result;
      },
      {
        timeout: 5_000,
      },
    );
    expect(snapshot).toBeTruthy();
  });

  test("get some result with longer interspeech timeout", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: 'Say: hey <break time="2000"/> test' },
    });
    await waitForView(actor, "speaking", 10_000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
      value: { completeTimeout: 2000 },
    });
    const snapshot = await waitFor(
      actor,
      (snapshot) => {
        return !!snapshot.context.result;
      },
      {
        timeout: 15_000,
      },
    );
    expect(snapshot).toBeTruthy();
  });

  test("ultra-short noinput timeout", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Keep silent" },
    });
    await waitForView(actor, "speaking", 10_000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
      value: { noInputTimeout: 500 },
    });
    const snapshot = await waitFor(
      actor,
      (snapshot) => {
        return snapshot.context.result === null;
      },
      {
        timeout: 10_000,
      },
    );
    expect(snapshot).toBeTruthy();
  });
});
