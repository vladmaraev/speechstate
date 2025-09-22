import {
  setup,
  assign,
  fromPromise,
  sendParent,
  stopChild,
  sendTo,
  assertEvent,
} from "xstate";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";
import { visemesMachine } from "./visemes";
import { getToken } from "./getToken";

import type {
  Settings,
  Agenda,
  Hypothesis,
  RecogniseParameters,
  SpeechStateEvent,
} from "./types";

interface SSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
  azureAuthorizationToken?: string;
  bargeIn: false | RecogniseParameters;
}

const speechstate = setup({
  types: {} as {
    input: Settings;
    context: SSContext;
    events: SpeechStateEvent;
  },
  actors: {
    audioContext: fromPromise<AudioContext, void>(async () => {
      const audioContext = new AudioContext();
      navigator.mediaDevices
        .getUserMedia({ audio: { autoGainControl: false } })
        .then(function (stream) {
          audioContext.createMediaStreamSource(stream);
        });
      return audioContext;
    }),
    getToken: getToken,
    tts: ttsMachine,
    asr: asrMachine,
    visemes: visemesMachine,
  },
  actions: {
    spawnTTS: assign({
      ttsRef: ({ context, spawn }) => {
        return spawn("tts", {
          id: "ttsRef",
          input: {
            azureAuthorizationToken: context.azureAuthorizationToken,
            ttsDefaultVoice: context.settings.ttsDefaultVoice,
            ttsDefaultFillerDelay: context.settings.ttsDefaultFillerDelay,
            ttsDefaultFiller: context.settings.ttsDefaultFiller,
            ttsLexicon: context.settings.ttsLexicon,
            audioContext: context.audioContext,
            azureRegion: context.settings.azureRegion,
            locale: context.settings.locale,
          },
        });
      },
    }),
    spawnASR: assign({
      asrRef: ({ context, spawn }) => {
        return spawn("asr", {
          id: "asrRef",
          input: {
            azureAuthorizationToken: context.azureAuthorizationToken,
            asrDefaultCompleteTimeout:
              context.settings.asrDefaultCompleteTimeout,
            asrDefaultNoInputTimeout: context.settings.asrDefaultNoInputTimeout,
            locale: context.settings.locale,
            audioContext: context.audioContext,
            azureRegion: context.settings.azureRegion,
            azureLanguageCredentials: context.settings.azureLanguageCredentials,
            speechRecognitionEndpointId:
              context.settings.speechRecognitionEndpointId,
          },
        });
      },
    }),
    "tts.stop": ({ context }) =>
      context.ttsRef!.send({
        type: "STOP",
      }),
  },
  delays: {
    NEW_TOKEN_INTERVAL: ({ context }) => {
      return context.settings.newTokenInterval || 300_000;
    },
  },
  guards: {
    bargein_enabled: ({ context }) => !!context.bargeIn,
  },
}).createMachine({
  context: ({ input }) => ({
    settings: input,
    bargeIn: input.bargeIn,
  }),
  id: "speechstate",
  initial: "Active",
  states: {
    Stopped: {
      meta: { view: "stopped" },
      entry: [
        stopChild("ttsRef"),
        stopChild("asrRef"),
        assign({
          audioContext: undefined,
          ttsRef: undefined,
          asrRef: undefined,
        }),
        () => console.debug("[SpSt] destroyed ASR and TTS"),
      ],
    },
    Active: {
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
                onDone: [
                  {
                    guard: ({ context }) => !!context.settings.noPonyfill,
                    target: "Spawn",
                    actions: [
                      assign(({ event }) => {
                        return {
                          audioContext: event.output,
                        };
                      }),
                    ],
                  },
                  {
                    target: "GenerateToken",
                    actions: [
                      assign(({ event }) => {
                        return {
                          audioContext: event.output,
                        };
                      }),
                    ],
                  },
                ],
              },
            },
            GenerateToken: {
              invoke: {
                id: "getAuthorizationToken",
                input: ({ context }) => ({
                  credentials: context.settings.azureCredentials,
                }),
                src: "getToken",
                onDone: {
                  target: "Spawn",
                  actions: assign(({ event }) => {
                    return { azureAuthorizationToken: event.output };
                  }),
                },
                onError: {
                  actions: ({ event }) =>
                    console.error("[SpSt.GenerateToken]", event.error),
                  target: "Fail",
                },
              },
            },
            Spawn: {
              entry: [{ type: "spawnTTS" }, { type: "spawnASR" }],
              after: {
                NEW_TOKEN_INTERVAL: {
                  guard: ({ context }) => !context.settings.noPonyfill,
                  target: "GenerateNewTokens",
                  actions: ({}) => console.debug("[SpSt] generating new token"),
                },
              },
            },
            GenerateNewTokens: {
              invoke: {
                id: "getNewAuthorizationToken",
                input: ({ context }) => ({
                  credentials: context.settings.azureCredentials,
                }),
                src: "getToken",
                onDone: {
                  actions: [
                    assign(({ event }) => {
                      return { azureAuthorizationToken: event.output };
                    }),
                    ({ context, event }) =>
                      context.ttsRef.send({
                        type: "NEW_TOKEN",
                        value: event.output,
                      }),
                    ({ context, event }) =>
                      context.asrRef.send({
                        type: "NEW_TOKEN",
                        value: event.output,
                      }),
                    ({}) => console.debug("[SpSt→TTS] NEW_TOKEN"),
                    ({}) => console.debug("[SpSt→ASR] NEW_TOKEN"),
                  ],
                },
                onError: {
                  actions: ({ event }) =>
                    console.error("[SpSt.GenerateNewToken]", event.error),
                  target: "Fail",
                },
              },
              after: {
                NEW_TOKEN_INTERVAL: {
                  target: "GenerateNewTokens",
                  reenter: true,
                  actions: ({}) => console.debug("[SpSt] generating new token"),
                },
              },
            },
            Fail: { meta: { view: "error" } },
          },
        },
        AsrTtsManager: {
          initial: "Initialize",
          on: {
            // ASR_ERROR not implemented
            TTS_ERROR: {
              actions: () => console.error("[TTS→SpSt] TTS_ERROR"),
              target: ".Fail",
            },
            ASR_NOINPUT: {
              actions: [
                () => console.debug("[ASR→SpSt] NOINPUT"),
                () => console.info("%cU】*no input*", "font-weight: bold"),
                sendParent({ type: "ASR_NOINPUT" }),
              ],
            },
            LISTEN_COMPLETE: {
              actions: [
                () => console.debug("[ASR→SpSt] LISTEN_COMPLETE"),
                sendParent({
                  type: "LISTEN_COMPLETE",
                }),
              ],
              target: ".Ready",
            },
            STOP: "#speechstate.Stopped",
          },
          states: {
            Initialize: {
              meta: { view: "not-ready" },
              on: {
                TTS_READY: {
                  actions: () => console.debug("[TTS→SpSt] TTS_READY"),
                  target: "PreReady",
                },
                ASR_READY: {
                  actions: () => console.debug("[ASR→SpSt] ASR_READY"),
                  target: "PreReady",
                },
              },
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
              on: {
                RECOGNISED: {
                  actions: [
                    ({ event }) =>
                      console.debug(
                        "[ASR→SpSt] RECOGNISED",
                        (event as any).value,
                        (event as any).nluValue,
                      ),
                    ({ event }) =>
                      console.info(
                        "%cU】%s",
                        "font-weight: bold",
                        (event as any).value[0].utterance,
                        (event as any).value[0].confidence,
                      ),
                    sendParent(({ event }) => ({
                      type: "RECOGNISED",
                      value: (event as any).value,
                      nluValue: (event as any).nluValue,
                    })),
                  ],
                },
                UPDATE_ASR_PARAMETERS: {
                  actions: [
                    () => console.debug("[SpSt→ASR] UPDATE_ASR_PARAMETERS"),
                    ({ context, event }) =>
                      context.asrRef.send({
                        type: "UPDATE_ASR_PARAMETERS",
                        value: event.value,
                      }),
                  ],
                },
              },
              states: {
                Idle: {
                  meta: { view: "idle" },
                  on: {
                    LISTEN: { target: "WaitForRecogniser" },
                    SPEAK: {
                      target: "Speaking",
                      /**
                       * SPEAK can prevent barge-in, otherwise it is
                       *  taken from the context (settings overriden by SPEAK value)
                       */
                      actions: assign(({ event, context }) => ({
                        bargeIn:
                          event.value.bargeIn ?? context.settings.bargeIn,
                      })),
                    },
                  },
                },
                Speaking: {
                  invoke: {
                    id: "visemes",
                    src: "visemes",
                    input: {},
                  },
                  initial: "Start",
                  on: {
                    STOP: {
                      target: "#speechstate.Stopped",
                      actions: [
                        ({}) => console.debug("[SpSt→TTS] STOP"),
                        ({ context }) =>
                          context.ttsRef.send({
                            type: "STOP",
                          }),
                      ],
                    },
                    VISEME: {
                      actions: [
                        // ({ event }) =>
                        //   console.debug("[TTS→SpSt] VISEME", event.value),
                        sendTo("visemes", ({ event }) => ({
                          type: "VISEME",
                          value: event.value,
                        })),
                      ],
                    },
                    FURHAT_BLENDSHAPES: {
                      actions: [
                        ({ event }) =>
                          console.debug(
                            "[SpSt] FURHAT_BLENDSHAPES",
                            event.value,
                          ),
                        sendParent(({ event }) => ({
                          type: "FURHAT_BLENDSHAPES",
                          value: (event as any).value,
                        })),
                      ],
                    },
                    SPEAK_COMPLETE: [
                      {
                        guard: { type: "bargein_enabled" },
                        target: ".Proceed.Recognising",
                        actions: [
                          () =>
                            console.debug(
                              "[TTS→SpSt] SPEAK_COMPLETE (barge-in)",
                            ),
                          sendParent({ type: "SPEAK_COMPLETE" }),
                          ({ context }) =>
                            context.asrRef.send({
                              type: "START_NOINPUT_TIMEOUT",
                            }),
                        ],
                      },
                      {
                        target: "Idle",
                        actions: [
                          () => console.debug("[TTS→SpSt] SPEAK_COMPLETE"),
                          sendParent({ type: "SPEAK_COMPLETE" }),
                        ],
                      },
                    ],
                  },
                  states: {
                    Start: {
                      meta: { view: "idle" },
                      entry: [
                        ({ event }) => {
                          assertEvent(event, "SPEAK");
                          console.debug("[SpSt→TTS] SPEAK", event.value);
                        },
                        ({ context, event }) => {
                          assertEvent(event, "SPEAK");
                          context.ttsRef.send({
                            type: "SPEAK",
                            value: {
                              ...event.value,
                              ...{ bargeIn: context.bargeIn },
                            },
                          });
                        },
                      ],
                      on: {
                        TTS_STARTED: [
                          {
                            target: "StartASR",
                            guard: { type: "bargein_enabled" },
                          },
                          {
                            target: "Proceed",
                          },
                        ],
                      },
                    },
                    StartASR: {
                      meta: { view: "speaking" },
                      entry: [
                        () => console.debug("[SpSt→ASR] START"),
                        ({ context }) =>
                          context.asrRef.send({
                            type: "START",
                            value: context.bargeIn,
                          }),
                      ],
                      on: {
                        ASR_STARTED: {
                          target: "Proceed",
                          actions: [
                            () => console.debug("[ASR→SpSt] ASR_STARTED"),
                            sendParent({ type: "ASR_STARTED" }),
                          ],
                        },
                      },
                    },
                    Proceed: {
                      initial: "NotInterrupted",
                      entry: [
                        () => console.debug("[TTS→SpSt] TTS_STARTED"),
                        sendParent({ type: "TTS_STARTED" }),
                      ],
                      on: {
                        STARTSPEECH: {
                          target: ".Recognising",
                          actions: [
                            () =>
                              console.debug(
                                "[ASR→SpSt] STARTSPEECH (barge-in)",
                              ),
                            { type: "tts.stop" },
                          ],
                        },
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
                      states: {
                        NotInterrupted: {
                          meta: { view: "speaking" },
                        },
                        Recognising: {
                          meta: { view: "recognising" },
                        },
                      },
                    },
                    Paused: {
                      meta: { view: "speaking-paused" },
                      on: {
                        SPEAK_COMPLETE: {},
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
                    () => console.debug("[SpSt→ASR] START"),
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
                        ({ context }) =>
                          context.asrRef.send({
                            type: "START_NOINPUT_TIMEOUT",
                          }),
                      ],
                    },
                  },
                },
                Recognising: {
                  initial: "Proceed",
                  on: {
                    STOP: {
                      target: "#speechstate.Stopped",
                      actions: [
                        () => console.debug("[SpSt→ASR] STOP"),
                        ({ context }) =>
                          context.asrRef.send({
                            type: "STOP",
                          }),
                      ],
                    },
                  },
                  states: {
                    Proceed: {
                      meta: { view: "recognising" },
                      on: {
                        CONTROL: {
                          target: "Paused",
                          actions: [
                            () => console.debug("[SpSt→ASR] CONTROL"),
                            ({ context }) =>
                              context.asrRef.send({
                                type: "CONTROL",
                              }),
                          ],
                        },
                      },
                    },
                    Paused: {
                      meta: { view: "recognising-paused" },
                      on: {
                        CONTROL: {
                          target: "Proceed",
                          actions: [
                            () => console.debug("[SpSt→ASR] CONTROL"),
                            ({ context }) =>
                              context.asrRef.send({
                                type: "CONTROL",
                              }),
                          ],
                        },
                      },
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
  },
});

export { speechstate };
