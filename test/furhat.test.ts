import { createActor, fromPromise, setup, assign } from "xstate";
import { describe, test, expect, beforeEach } from "vitest";

import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { waitForView, pause } from "./helpers";

const visemeMap: { [key: string]: any } = {
  // Silence
  0: { MOUSE_CLOSE: 0, JAW_OPEN: 0 },
  // æ, ə, ʌ
  1: { PHONE_AAH: 1 },
  // ɑ
  2: { PHONE_AAH: 1 },
  // ɔ
  3: { PHONE_OOH: 1 },
  // ɛ, ʊ
  4: { PHONE_EE: 1 },
  // ɝ
  5: { PHONE_EE: 1 },
  // j, i, ɪ
  6: { PHONE_I: 1 },
  // w, u
  7: { PHONE_U: 1 },
  // o
  8: { PHONE_OOH: 1 },
  // aʊ
  9: { PHONE_AAH: 1 },
  // ɔɪ
  10: { PHONE_OOH: 1 },
  // aɪ
  11: { PHONE_AAH: 1 },
  // h
  12: { PHONE_AAH: 1 },
  // ɹ
  13: { PHONE_R: 1 },
  // l
  14: { PHONE_TH: 1 },
  // s, z
  15: { PHONE_D_S_T: 1 },
  // ʃ, tʃ, dʒ, ʒ
  16: { PHONE_CH_J_SH: 1 },
  // ð
  17: { PHONE_TH: 1 },
  // f, v
  18: { PHONE_F_V: 1 },
  // d, t, n, θ
  19: { PHONE_D_S_T: 1 },
  //  k, g, ŋ
  20: { PHONE_K: 1 },
  // p, b, m
  21: { PHONE_B_M_P: 1 },
};

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
      fhGesture: fromPromise<any, { frames: number[]; viseme: string }>(
        ({ input }) => {
          const frames = [
            {
              time: input.frames,
              params: visemeMap[input.viseme],
              persist: false,
            },
            {
              time: [0.35],
              params: {
                reset: true,
              },
            },
          ];
          console.log(input.viseme, frames);
          return fhFetch(frames);
        },
      ),
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
        frames: [],
        viseme: "",
      };
    },
    initial: "Idle",
    states: {
      Idle: {
        on: {
          VISEME: {
            target: "Viseming",
            reenter: true,
            actions: assign(({ event }) => {
              return { frames: event.value.frames, viseme: event.value.name };
            }),
          },
        },
      },
      Viseming: {
        invoke: {
          id: "vis",
          src: "fhGesture",
          input: ({ context }) => ({
            frames: context.frames,
            viseme: context.viseme,
          }),
          onDone: "Idle",
        },
      },
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
      value: {
        utterance: 'Hello, I am Furhat. <break time="1000"/> How is it going?', // <mstts:viseme type="FacialExpression"/>
        voice: "en-US-AvaNeural",
        visemes: true,
      },
    });
    const snapshot = await waitForView(actor, "speaking", 500);
    // const snapshot = await waitForView(actor, "idle", 9000);
    expect(snapshot).toBeTruthy();
  });
});
