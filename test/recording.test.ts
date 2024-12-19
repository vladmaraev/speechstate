import { createActor, fromPromise, setup, waitFor } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { waitForView, pause } from "./helpers";

import { createClient } from "@supabase/supabase-js";

describe("Recording test", async () => {
  const testMachine = setup({
    actors: {
      uploadRecording: fromPromise<void, Blob>(async ({ input }) => {
        const supabase = createClient(
          "", // url
          "", // key
        );
        const { data, error } = await supabase.storage
          .from("") // bucket
          .upload("rec/test.webm", input, {
            upsert: true,
          });
        console.log("uploaded: ", data);
      }),
    },
  }).createMachine({
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
            newTokenInterval: 50_000,
            isConversationRecorded: true,
          },
        }),
      };
    },
    initial: "Idle",
    states: {
      Idle: {
        on: { RECORDING_AVAILABLE: "Uploading" },
      },
      Uploading: {
        invoke: {
          src: "uploadRecording",
          input: ({ event }) => event.value,
          onDone: "Done",
        },
      },
      Done: {},
    },
  });
  const actor = createActor(testMachine).start();
  actor
    .getSnapshot()
    .context.ssRef.subscribe((snapshot) =>
      console.log("[test.SpeechState state]", snapshot.value),
    );

  actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });

  beforeEach(async () => {
    await waitForView(actor, "idle", 10000);
  });

  test("record conversation", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: { utterance: "Say hey" },
    });
    await waitForView(actor, "speaking", 1000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "LISTEN",
    });
    await waitForView(actor, "recognising", 1000);
    await waitForView(actor, "idle", 10_000);
    actor.getSnapshot().context.ssRef.send({
      type: "FINALISE_RECORDING",
    });
    const snapshot = await waitFor(
      actor.getSnapshot().context.ssRef,
      (snapshot) => {
        return snapshot.value.ConversationRecorder === "Finalised";
      },
      {
        timeout: 5_000,
      },
    );

    expect(snapshot).toBeTruthy();
  });
});
