import { setup, assign, fromPromise, sendParent, stopChild } from "xstate";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";

import { Settings, SpeechStateEvent } from "./types";
interface SSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
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
        .getUserMedia({ audio: true })
        .then(function (stream) {
          audioContext.createMediaStreamSource(stream);
        });
      return audioContext;
    }),
    tts: ttsMachine,
    asr: asrMachine,
  },
  actions: {
    spawnTTS: assign({
      ttsRef: ({ context, spawn }) => {
        return spawn("tts", {
          id: "ttsRef",
          input: {
            ttsDefaultVoice: context.settings.ttsDefaultVoice,
            ttsLexicon: context.settings.ttsLexicon,
            audioContext: context.audioContext,
            azureCredentials: context.settings.azureCredentials,
            azureRegion: context.settings.azureRegion,
          },
        });
      },
    }),
    spawnASR: assign({
      asrRef: ({ context, spawn }) => {
        return spawn("asr", {
          id: "asrRef",
          input: {
            asrDefaultCompleteTimeout:
              context.settings.asrDefaultCompleteTimeout,
            asrDefaultNoInputTimeout: context.settings.asrDefaultNoInputTimeout,
            locale: context.settings.locale,
            audioContext: context.audioContext,
            azureCredentials: context.settings.azureCredentials,
            azureRegion: context.settings.azureRegion,
            azureLanguageCredentials: context.settings.azureLanguageCredentials,
            speechRecognitionEndpointId:
              context.settings.speechRecognitionEndpointId,
          },
        });
      },
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    settings: input,
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
                onDone: {
                  target: "Spawn",
                  actions: assign(({ event }) => {
                    return {
                      audioContext: event.output,
                    };
                  }),
                },
              },
            },
            Spawn: {
              entry: [{ type: "spawnTTS" }, { type: "spawnASR" }],
              after: {
                300000: {
                  target: "Spawn",
                  reenter: true,
                  actions: [
                    ({}) => console.debug("[SpSt] respawning ASR and TTS"),
                    stopChild("ttsRef"),
                    stopChild("asrRef"),
                    assign({
                      audioContext: undefined,
                      ttsRef: undefined,
                      asrRef: undefined,
                    }),
                  ],
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
            STOP: "#speechstate.Stopped",
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
                      target: "#speechstate.Stopped",
                      actions: [
                        ({}) => console.debug("[SpSt→TTS] STOP"),
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
                    STREAMING_SET_PERSONA: {
                      actions: [
                        () => console.debug("[TTS→SpSt] STREAMING_SET_PERSONA"),
                        sendParent(({ event }) => ({
                          type: "STREAMING_SET_PERSONA",
                          value: event.value,
                        })),
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
