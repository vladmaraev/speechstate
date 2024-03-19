import {
  createMachine,
  assign,
  fromPromise,
  sendParent,
  stopChild,
} from "xstate";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";

import { Settings, Agenda, Hypothesis, RecogniseParameters } from "./types";
interface SSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
}

/** events sent to the spawned `speechstate` machine **/
type SSEventExtIn =
  | { type: "PREPARE" }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "LISTEN"; value: RecogniseParameters };

/** for sendParent, not type-checked */
type SSEventExtOut =
  | { type: "ASR_NOINPUT" }
  | { type: "ASRTTS_READY" }
  | { type: "ASR_STARTED" }
  | { type: "TTS_STARTED" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "RECOGNISED"; value: Hypothesis[]; nluValue?: any };

type SSEventIntIn =
  | { type: "TTS_READY" }
  | { type: "ASR_READY" }
  | { type: "TTS_ERROR" };

type SSEvent = SSEventIntIn | SSEventExtIn | SSEventExtOut;

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
        on: {
          STOP: { target: "Stopped", actions: assign({ audioContext: null }) },
        },
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
                    id: "ttsRef",
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
                    id: "asrRef",
                    input: {
                      asrDefaultCompleteTimeout:
                        context.settings.asrDefaultCompleteTimeout,
                      asrDefaultNoInputTimeout:
                        context.settings.asrDefaultNoInputTimeout,
                      locale: context.settings.locale,
                      audioContext: context.audioContext,
                      azureCredentials: context.settings.azureCredentials,
                      azureLanguageCredentials:
                        context.settings.azureLanguageCredentials,
                      speechRecognitionEndpointId:
                        context.settings.speechRecognitionEndpointId,
                    },
                  });
                },
              }),
            ],
            exit: [
              stopChild("ttsRef"),
              stopChild("asrRef"),
              assign({ ttsRef: undefined, asrRef: undefined }),
            ],
            after: {
              300000: {
                target: "Spawn",
                reenter: true,
              },
            },
          },
          Stopped: {},
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
          STOP: ".Stopped",
        },
        states: {
          Initialize: {
            meta: { view: "not-ready" },
          },
          PreReady: {
            meta: { view: "not-ready" },
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
                meta: { view: "idle" },
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
                initial: "Proceed",
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
                  STOP: {
                    target: "Stopped",
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
                states: {
                  Proceed: {
                    meta: { view: "speaking" },
                    on: {
                      CONTROL: {
                        target: "Paused",
                        actions: [
                          () => console.debug("[SpSt→TTS] CONTROL"),
                          ({ context }) =>
                            context.ttsRef.send({
                              type: "CONTROL",
                            }),
                        ],
                      },
                    },
                  },
                  Paused: {
                    meta: { view: "speaking-paused" },
                    on: {
                      CONTROL: {
                        target: "Proceed",
                        actions: [
                          () => console.debug("[SpSt→TTS] CONTROL"),
                          ({ context }) =>
                            context.ttsRef.send({
                              type: "CONTROL",
                            }),
                        ],
                      },
                    },
                  },
                },
              },
              WaitForRecogniser: {
                meta: { view: "idle" },
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
                meta: { view: "recognising" },
                on: {
                  CONTROL: {
                    /** TODO go to paused state? */
                    actions: [
                      () => console.debug("[SpSt→ASR] CONTROL"),
                      ({ context }) =>
                        context.asrRef.send({
                          type: "CONTROL",
                        }),
                    ],
                  },
                  STOP: {
                    target: "Stopped",
                    actions: [
                      () => console.debug("[SpSt→ASR] STOP"),
                      ({ context }) =>
                        context.asrRef.send({
                          type: "STOP",
                        }),
                    ],
                  },
                  RECOGNISED: {
                    actions: [
                      ({ event }) =>
                        console.debug(
                          "[ASR→SpSt] RECOGNISED",
                          (event as any).value,
                          (event as any).nluValue,
                        ),
                      sendParent(({ event }) => ({
                        type: "RECOGNISED",
                        value: (event as any).value,
                        nluValue: (event as any).nluValue,
                      })),
                    ],
                    target: "Idle",
                  },
                },
              },
            },
          },
          Fail: { meta: { view: "error" } },
          Stopped: { meta: { view: "stopped" } },
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
