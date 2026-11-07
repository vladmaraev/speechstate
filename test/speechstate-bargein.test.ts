import {
  assign,
  createActor,
  fromPromise,
  sendParent,
  setup,
  waitFor,
} from "xstate";
import { expect, test } from "vitest";

import { speechstate } from "../src/speechstate";

type TestEvent = { type: string; value?: any };

const testTtsMachine = setup({
  types: {} as { events: TestEvent },
}).createMachine({
  id: "test-tts",
  initial: "Ready",
  states: {
    Ready: {
      entry: sendParent({ type: "TTS_READY" }),
      on: { SPEAK: "Speaking" },
    },
    Speaking: {
      on: {
        TEST_TTS_STARTED: {
          actions: sendParent({ type: "TTS_STARTED" }),
        },
      },
    },
  },
});

const testAsrMachine = setup({
  types: {} as {
    context: {
      params?: Record<string, any>;
      startParams?: Record<string, any>;
      timeoutStartedWith?: number;
    };
    events: TestEvent;
  },
}).createMachine({
  id: "test-asr",
  context: () => ({}),
  entry: sendParent({ type: "ASR_READY" }),
  on: {
    UPDATE_ASR_PARAMETERS: {
      actions: assign(({ event }) => ({ params: event.value })),
    },
    START: {
      actions: [
        assign(({ event }) => ({
          params: event.value,
          startParams: event.value,
        })),
        sendParent({ type: "ASR_STARTED" }),
      ],
    },
    START_NOINPUT_TIMEOUT: {
      actions: [
        assign(({ context }) => ({
          timeoutStartedWith: context.params?.noInputTimeout,
        })),
        sendParent({ type: "ASR_NOINPUT" }),
      ],
    },
  },
});

const speechstateWithTestActors = speechstate.provide({
  actors: {
    audioContext: fromPromise(async () => ({} as AudioContext)) as any,
    tts: testTtsMachine as any,
    asr: testAsrMachine as any,
  },
});

const testMachine = setup({
  types: {} as {
    context: {
      speechRef: any;
      ready: boolean;
      asrStarted: boolean;
      noInput: boolean;
    };
    events: TestEvent;
  },
}).createMachine({
  context: ({ spawn }) => ({
    speechRef: spawn(speechstateWithTestActors, {
      input: { bargeIn: false, noPonyfill: true },
    }),
    ready: false,
    asrStarted: false,
    noInput: false,
  }),
  on: {
    ASRTTS_READY: { actions: assign({ ready: true }) },
    ASR_STARTED: { actions: assign({ asrStarted: true }) },
    ASR_NOINPUT: { actions: assign({ noInput: true }) },
  },
});

test("ASR parameter updates during barge-in speech survive recognition start", async () => {
  const actor = createActor(testMachine).start();
  const speechRef = actor.getSnapshot().context.speechRef;

  speechRef.send({ type: "PREPARE" });
  await waitFor(actor, (snapshot) => snapshot.context.ready, {
    timeout: 1_000,
  });

  speechRef.send({
    type: "SPEAK",
    value: {
      utterance: "Please wait.",
      bargeIn: { noInputTimeout: 86_400_000 },
    },
  });
  speechRef.send({
    type: "UPDATE_ASR_PARAMETERS",
    value: { noInputTimeout: 0 },
  });

  speechRef.getSnapshot().context.ttsRef.send({ type: "TEST_TTS_STARTED" });
  await waitFor(actor, (snapshot) => snapshot.context.asrStarted, {
    timeout: 1_000,
  });

  const asrRef = speechRef.getSnapshot().context.asrRef;
  expect(asrRef.getSnapshot().context.startParams.noInputTimeout).toBe(0);

  speechRef.send({ type: "SPEAK_COMPLETE" });
  await waitFor(actor, (snapshot) => snapshot.context.noInput, {
    timeout: 1_000,
  });

  expect(asrRef.getSnapshot().context.timeoutStartedWith).toBe(0);
  actor.stop();
});
