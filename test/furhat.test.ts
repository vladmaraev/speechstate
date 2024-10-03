import { createActor, fromPromise, setup, assign } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { Frame } from "../src/types";
import { AZURE_KEY } from "../src/credentials";
import { waitForView, pause } from "./helpers";

const fhFetch = async (frames) =>
  fetch(
    `http://localhost:8181/http://127.0.0.1:54321/furhat/gesture?blocking=false`,
    {
      method: "POST",
      headers: { accept: "application/json", origin: "localhost" },
      body: JSON.stringify({
        name: "Viseme",
        frames: frames,
        class: "furhatos.gestures.Gesture",
      }),
    },
  );

describe("Furhat visemes test", async () => {
  const testMachine = setup({
    actors: {
      fhBlendShape: fromPromise<any, { frames: Frame[] }>(({ input }) => {
        return fhFetch(input.frames);
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
          },
        }),
      };
    },
    initial: "Idle",
    on: {
      FURHAT_BLENDSHAPES: {
        target: ".Animating",
        reenter: true,
      },
    },
    states: {
      Idle: {},
      Animating: {
        invoke: {
          id: "vis",
          src: "fhBlendShape",
          input: ({ event }) => ({
            frames: event.value,
          }),
        },
      },
    },
  });
  const actor = createActor(testMachine).start();
  actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });

  await waitForView(actor, "idle", 5000);
  // actor.subscribe((snapshot) =>
  //   console.log("[test state]", snapshot.value, snapshot.context),
  // );

  beforeEach(async () => {
    await waitForView(actor, "idle", 10000);
  });

  test("synthesise", async () => {
    actor.getSnapshot().context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: `<mstts:viseme type="FacialExpression"/>Hello, I am Furhat. <break time="1000"/> How is it going?`, // <mstts:viseme type="FacialExpression"/>
        voice: "en-US-AvaNeural",
        visemes: true,
      },
    });
    await waitForView(actor, "speaking", 500);
    const snapshot = await waitForView(actor, "idle", 10000);
    expect(snapshot).toBeTruthy();
  });
});
