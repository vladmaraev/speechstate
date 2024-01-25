import { createMachine, assign, fromPromise, sendParent } from "xstate";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";

import { Settings, Agenda, Hypothesis } from "./types";
interface SSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
}

type SSEvent =
  | { type: "PREPARE" }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "TTS_READY" }
  | { type: "TTS_STARTED" }
  | { type: "TTS_ERROR" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "ASR_READY" }
  | { type: "LISTEN" } // TODO parameters!
  | { type: "ASR_STARTED" }
  | { type: "ASR_NOINPUT" }
  | { type: "RECOGNISED"; value: Hypothesis[] };

const speechstate = createMachine(
  {
    types: {} as {
      input: Settings;
      context: SSContext;
      events: SSEvent;
    },
    context: ({ input }) => ({
      settings: input,
    }),
    id: "speechstate",
    type: "parallel",
    states: {
      AsrTtsSpawner: {
        initial: "Idle",
        states: {
          Idle: { on: { PREPARE: "CreateAudioContext" } },
          CreateAudioContext: {
            invoke: {
              id: "createAudioContext",
              src: "audioContext",
              onDone: {
                target: "Spawn",
                actions: assign({ audioContext: ({ event }) => event.output }),
              },
            },
          },
          Spawn: {
            entry: [
              assign({
                ttsRef: ({ context, spawn }) => {
                  return spawn(ttsMachine, {
                    input: {
                      ttsDefaultVoice: context.settings.ttsDefaultVoice,
                      audioContext: context.audioContext,
                      azureCredentials: context.settings.azureCredentials,
                    },
                  });
                },
              }),
              assign({
                asrRef: ({ context, spawn }) => {
                  return spawn(asrMachine, {
                    input: {
                      asrDefaultCompleteTimeout:
                        context.settings.asrDefaultCompleteTimeout,
                      asrDefaultNoInputTimeout:
                        context.settings.asrDefaultNoInputTimeout,
                      locale: context.settings.locale,
                      audioContext: context.audioContext,
                      azureCredentials: context.settings.azureCredentials,
                    },
                  });
                },
              }),
            ],
            after: {
              300000: {
                target: "Spawn",
              },
            },
          },
        },
      },
      AsrTtsManager: {
        initial: "Initialize",
        on: {
          TTS_READY: {
            actions: () => console.debug("[TTS→SpSt] TTS_READY"),
            target: ".PreReady",
          },
          ASR_READY: {
            actions: () => console.debug("[ASR→SpSt] ASR_READY"),
            target: ".PreReady",
          },
          // ASR_ERROR not implemented
          TTS_ERROR: {
            actions: () => console.error("[TTS→SpSt] TTS_ERROR"),
            target: ".Fail",
          },
          ASR_NOINPUT: {
            actions: [
              () => console.debug("[ASR→SpSt] NOINPUT"),
              sendParent({ type: "ASR_NOINPUT" }),
            ],
            target: ".Ready",
          },
        },
        states: {
          Initialize: {},
          PreReady: {
            on: {
              TTS_READY: {
                actions: () => console.debug("[TTS→SpSt] TTS_READY"),
                target: "Ready",
              },
              ASR_READY: {
                actions: () => console.debug("[ASR→SpSt] ASR_READY"),
                target: "Ready",
              },
            },
          },
          Ready: {
            initial: "Idle",
            entry: [
              () => console.debug("[SpSt] All ready"),
              sendParent({ type: "ASRTTS_READY" }),
            ],
            states: {
              Idle: {
                on: {
                  LISTEN: { target: "WaitForRecogniser" },
                  SPEAK: [
                    {
                      target: "Speaking",
                    },
                  ],
                },
              },
              Speaking: {
                entry: [
                  ({ event }) =>
                    console.debug("[SpSt→TTS] SPEAK", (event as any).value),
                  ({ context, event }) =>
                    context.ttsRef.send({
                      type: "SPEAK",
                      value: (event as any).value,
                    }),
                ],
                on: {
                  CONTROL: {
                    actions: [
                      () => console.debug("[SpSt→TTS] CONTROL"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "CONTROL",
                        }),
                    ],
                  },
                  STOP: {
                    actions: [
                      () => console.debug("[SpSt→TTS] STOP"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "STOP",
                        }),
                    ],
                  },
                  TTS_STARTED: {
                    actions: [
                      () => console.debug("[TTS→SpSt] TTS_STARTED"),
                      sendParent({ type: "TTS_STARTED" }),
                    ],
                  },
                  SPEAK_COMPLETE: {
                    target: "Idle",
                    actions: [
                      () => console.debug("[TTS→SpSt] SPEAK_COMPLETE"),
                      sendParent({ type: "SPEAK_COMPLETE" }),
                    ],
                  },
                },
              },
              WaitForRecogniser: {
                entry: [
                  ({ event }) =>
                    console.debug("[SpSt→ASR] START", (event as any).value),
                  ({ context, event }) =>
                    context.asrRef.send({
                      type: "START",
                      value: (event as any).value,
                    }),
                ],
                on: {
                  ASR_STARTED: {
                    target: "Recognising",
                    actions: [
                      () => console.debug("[ASR→SpSt] ASR_STARTED"),
                      sendParent({ type: "ASR_STARTED" }),
                    ],
                  },
                },
              },
              Recognising: {
                on: {
                  CONTROL: {
                    actions: [
                      () => console.debug("[SpSt→ASR] CONTROL"),
                      ({ context }) =>
                        context.asrRef.send({
                          type: "CONTROL",
                        }),
                    ],
                  },
                  RECOGNISED: {
                    actions: [
                      ({ event }) =>
                        console.debug(
                          "[ASR→SpSt] RECOGNISED",
                          (event as any).value,
                        ),
                      sendParent(({ event }) => ({
                        type: "RECOGNISED",
                        value: (event as any).value,
                      })),
                    ],
                    target: "Idle",
                  },
                },
              },
            },
          },
          Fail: {},
        },
      },
    },
  },
  {
    actors: {
      audioContext: fromPromise(() => {
        const audioContext = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            audioContext.createMediaStreamSource(stream);
          });
        return audioContext;
      }),
    },
    actions: {
      //   logRecResult: ({ event }) => {
      //     console.log("U>", (event as any).value[0]["utterance"], {
      //       confidence: (event as any).value[0]["confidence"],
      //     });
      //   },
      //   logAgenda: ({ context, event }) => {
      //     console.log("S>", (event as any).value, {
      //       passivity: `${context.tdmPassivity ?? "∞"} ms`,
      //       speechCompleteTimeout: `${
      //         context.tdmSpeechCompleteTimeout ||
      //         context.settings.completeTimeout
      //       } ms`,
      //     });
      //   },
    },
  },
);

export { speechstate };
