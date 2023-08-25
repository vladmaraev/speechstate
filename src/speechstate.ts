import { createMachine, assign, fromPromise, sendParent } from "xstate";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";
// import { tdmDmMachine } from "./tdmClient";

const machine = createMachine(
  {
    types: {
      context: {} as SSContext,
      events: {} as SSEvent,
    },
    context: ({ input }) => ({
      settings: input.settings,
    }),
    id: "speechstate",
    type: "parallel",
    states: {
      asrTtsSpawner: {
        initial: "idle",
        states: {
          idle: { on: { PREPARE: "createAudioContext" } },
          createAudioContext: {
            invoke: {
              id: "createAudioContext",
              src: "audioContext",
              onDone: {
                target: "spawn",
                actions: assign({ audioContext: ({ event }) => event.output }),
              },
            },
          },
          spawn: {
            entry: [
              assign({
                ttsRef: ({ context, spawn }) => {
                  return spawn(ttsMachine, {
                    input: {
                      ttsDefaultVoice: "en-US-DavisNeural", // todo: config defaults
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
                      asrDefaultCompleteTimeout: 0, // todo: config defaults
                      asrDefaultNoInputTimeout: 5000,
                      locale: "en-US",
                      audioContext: context.audioContext,
                      azureCredentials: context.settings.azureCredentials,
                    },
                  });
                },
              }),
            ],
            after: {
              300000: {
                target: "spawn",
              },
            },
          },
        },
      },
      asrTtsManager: {
        initial: "initialize",
        on: {
          TTS_READY: {
            actions: () => console.debug("[TTS→SpSt] TTS_READY"),
            target: ".preReady",
          },
          ASR_READY: {
            actions: () => console.debug("[ASR→SpSt] ASR_READY"),
            target: ".preReady",
          },
          // ASR_ERROR not implemented
          TTS_ERROR: {
            actions: () => console.error("[TTS→SpSt] TTS_ERROR"),
            target: ".fail",
          },
          ASR_NOINPUT_TIMEOUT: {
            actions: () => console.debug("[ASR→SpSt] ASR_NOINPUT_TIMEOUT"),
            target: ".ready",
          },
        },
        states: {
          initialize: {},
          preReady: {
            on: {
              TTS_READY: {
                actions: () => console.debug("[TTS→SpSt] TTS_READY"),
                target: "ready",
              },
              ASR_READY: {
                actions: () => console.debug("[ASR→SpSt] ASR_READY"),
                target: "ready",
              },
            },
          },
          ready: {
            initial: "idle",
            entry: [
              () => console.debug("[SpSt] All ready"),
              // sendParent({ type: "ASRTTS_READY" }),
            ],
            states: {
              idle: {
                on: {
                  LISTEN: { target: "waitForRecogniser" },
                  SPEAK: [
                    {
                      target: "speaking",
                    },
                  ],
                },
              },
              speaking: {
                entry: [
                  ({ event }) =>
                    console.debug("[SpSt→TTS] START", (event as any).value),
                  ({ context, event }) =>
                    context.ttsRef.send({
                      type: "START",
                      value: (event as any).value,
                    }),
                ],
                on: {
                  PAUSE: {
                    actions: [
                      () => console.debug("[SpSt→TTS] PAUSE"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "PAUSE",
                        }),
                    ],
                  },
                  CONTINUE: {
                    actions: [
                      () => console.debug("[SpSt→TTS] CONTINUE"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "CONTINUE",
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
                  ENDSPEECH: {
                    target: "idle",
                    actions: [
                      () => console.debug("[TTS→SpSt] ENDSPEECH"),
                      // sendParent({ type: "ENDSPEECH" }),
                    ],
                  },
                },
              },
              waitForRecogniser: {
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
                    target: "recognising",
                    actions: () => console.debug("[ASR→SpSt] ASR_STARTED"),
                  },
                },
              },
              recognising: {
                on: {
                  PAUSE: {
                    actions: [
                      () => console.debug("[SpSt→ASR] PAUSE"),
                      ({ context }) =>
                        context.asrRef.send({
                          type: "PAUSE",
                        }),
                    ],
                  },
                  CONTINUE: {
                    actions: [
                      () => console.debug("[SpSt→ASR] CONTINUE"),
                      ({ context }) =>
                        context.asrRef.send({
                          type: "CONTINUE",
                        }),
                    ],
                  },
                  ASR_PAUSED: {
                    actions: () => console.debug("[ASR→SpSt] ASR_PAUSED"),
                  },
                  RECOGNISED: {
                    actions: [
                      ({ event }) =>
                        console.debug(
                          "[ASR→SpSt] RECOGNISED",
                          (event as any).value,
                        ),
                      // sendParent(({ event }) => ({
                      //   type: "RECOGNISED",
                      //   value: (event as any).value,
                      // })),
                    ],
                    target: "idle",
                  },
                },
              },
            },
          },
          fail: {},
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

export { machine };
