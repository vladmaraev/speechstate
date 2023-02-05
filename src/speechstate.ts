import { createMachine, assign, fromPromise, raise } from "xstate";
import { ttsMachine } from "./tts";
// import { asrMachine } from "./asr";
// import { tdmDmMachine } from "./tdmClient";

const machine = createMachine(
  {
    types: {
      context: {} as SDSContext,
      events: {} as SDSEvent,
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
                      ttsDefaultVoice: "en-US-DavisNeural",
                      audioContext: context.audioContext,
                      azureCredentials: context.settings.azureCredentials,
                    },
                  });
                },
              }),
            ],
            // after: {
            //   30000: {
            //     target: "spawn",
            //   },
            // },
          },
        },
      },
      asrTtsManager: {
        initial: "initialize",
        on: {
          TTS_READY: {
            actions: () => console.debug("[TTS→SDS] TTS_READY"),
            target: ".ready",
          },
          ASR_READY: {
            target: ".ready",
          },
          TTS_ERROR: {
            actions: () => console.error("[TTS→SDS] TTS_ERROR"),
            target: ".fail",
          },
          ASR_NOINPUT_TIMEOUT: ".ready",
        },
        states: {
          initialize: {
            initial: "ponyfill",
            states: {
              fail: {},
              ponyfill: {},
              preReady: {},
            },
          },
          ready: {
            initial: "idle",
            states: {
              idle: {
                on: {
                  LISTEN: [
                    // { target: "waitForRecogniser" }
                  ],
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
                    console.debug("[SDS→TTS] START", (event as any).value),
                  ({ context, event }) =>
                    context.ttsRef.send({
                      type: "START",
                      value: (event as any).value,
                    }),
                ],
                on: {
                  PAUSE: {
                    actions: [
                      () => console.debug("[SDS→TTS] PAUSE"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "PAUSE",
                        }),
                    ],
                  },
                  CONTINUE: {
                    actions: [
                      () => console.debug("[SDS→TTS] CONTINUE"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "CONTINUE",
                        }),
                    ],
                  },
                  STOP: {
                    actions: [
                      () => console.debug("[SDS→TTS] STOP"),
                      ({ context }) =>
                        context.ttsRef.send({
                          type: "STOP",
                        }),
                    ],
                  },
                  ENDSPEECH: {
                    target: "idle",
                    actions: () => console.debug("[SDS→TTS] ENDSPEECH"),
                  },
                },
              },
              // waitForRecogniser: {
              //   entry: ({ context }) =>
              //     context.asrRef.send({
              //       type: "START",
              //       value: {
              //         noinputTimeout: context.tdmPassivity ?? 1000 * 3600 * 24,
              //         completeTimeout:
              //           context.tdmSpeechCompleteTimeout ||
              //           context.settings.completeTimeout,
              //       },
              //     }),
              //   on: {
              //     ASR_STARTED: "recognising",
              //   },
              // },
              recognising: {
                on: {
                  RECOGNISED: {
                    target: "idle",
                    // actions: "logRecResult",
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
      // createAudioContext: ({ context }) => {
      //   const audioCtx = new ((window as any).AudioContext ||
      //     (window as any).webkitAudioContext)();
      //   navigator.mediaDevices
      //     .getUserMedia({ audio: true })
      //     .then(function (stream) {
      //       audioCtx.createMediaStreamSource(stream);
      //     });
      // },
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
  }
);

export { machine };
