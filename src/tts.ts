import {
  setup,
  sendParent,
  assign,
  fromCallback,
  stateIn,
  raise,
} from "xstate";

import {
  Agenda,
  TTSInit,
  TTSEvent,
  TTSContext,
  TTSPonyfillInput,
} from "./types";

import { getToken } from "./getToken";

import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

const UTTERANCE_CHUNK_REGEX = /(^.*([!?]+|([.,]+\s)))/;

export const ttsMachine = setup({
  types: {} as {
    input: TTSInit;
    context: TTSContext;
    events: TTSEvent;
  },
  actions: {
    ttsStop: ({ context }) => {
      context.wsaTTS!.cancel();
    },
    addFiller: assign(({ context }) => {
      const spaceIndex = context.buffer.lastIndexOf(" ");
      return {
        buffer:
          context.buffer.substring(0, spaceIndex) +
          " um," +
          context.buffer.substring(spaceIndex),
      };
    }),
    assignCurrentVoice: assign(
      ({
        event,
      }: {
        event: { type: "STREAMING_SET_VOICE"; value: string };
      }) => {
        return {
          currentVoice: event.value,
        };
      },
    ),
    sendParentCurrentPersona: sendParent(
      ({
        event,
      }: {
        event: { type: "STREAMING_SET_PERSONA"; value: string };
      }) => ({
        type: "STREAMING_SET_PERSONA",
        value: event.value,
      }),
    ),
  },
  actors: {
    getToken: getToken,
    createEventsFromStream: fromCallback(
      ({ sendBack, input }: { sendBack: any; input: Agenda }) => {
        const eventSource = new EventSource(input.stream);
        eventSource.addEventListener("STREAMING_DONE", (_event) => {
          console.debug("[TTS] received streaming done - closing event stream");
          sendBack({ type: "STREAMING_DONE" });
          eventSource.close();
        });
        eventSource.addEventListener("STREAMING_RESET", (_event) => {
          console.debug("[TTS] received streaming reset");
        });
        eventSource.addEventListener("STREAMING_CHUNK", (event) => {
          console.debug("[TTS] received streaming chunk:", event);
          sendBack({ type: "STREAMING_CHUNK", value: event.data });
        });
        eventSource.addEventListener("STREAMING_SET_VOICE", (event) => {
          console.debug("[TTS] received streaming voice set command:", event);
          sendBack({ type: "STREAMING_SET_VOICE", value: event.data });
        });
        eventSource.addEventListener("STREAMING_SET_PERSONA", (event) => {
          console.debug("[TTS] received streaming persona set command:", event);
          sendBack({ type: "STREAMING_SET_PERSONA", value: event.data });
        });
      },
    ),
    ponyfill: fromCallback<null, TTSPonyfillInput>(({ sendBack, input }) => {
      const ponyfill = createSpeechSynthesisPonyfill({
        audioContext: input.audioContext,
        credentials: {
          region: input.azureRegion,
          authorizationToken: input.azureAuthorizationToken,
        },
      });
      const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
      const tts = speechSynthesis;
      const ttsUtterance = SpeechSynthesisUtterance;
      tts.addEventListener("voiceschanged", () => {
        const voices = tts.getVoices();
        if (voices.length > 0) {
          console.debug("[TTS] READY");
          sendBack({
            type: "READY",
            value: { wsaTTS: tts, wsaUtt: ttsUtterance },
          });
        } else {
          console.error("[TTS] No voices available");
          sendBack({ type: "ERROR" });
        }
      });
    }),
    start: fromCallback(({ sendBack, input }) => {
      if (["", " "].includes((input as any).utterance)) {
        console.debug("[TTS] SPEAK: (empty utterance)");
        sendBack({ type: "SPEAK_COMPLETE" });
      } else {
        console.debug("[TTS] SPEAK: ", (input as any).utterance);
        const content = wrapSSML(
          (input as any).utterance,
          (input as any).voice,
          (input as any).ttsLexicon,
          1,
        ); // todo speech rate;
        const utterance = new (input as any).wsaUtt!(content);
        utterance.addEventListener("start", () => {
          sendBack({ type: "TTS_STARTED" });
          console.debug("[TTS] TTS_STARTED");
        });
        utterance.addEventListener("end", () => {
          sendBack({ type: "SPEAK_COMPLETE" });
          console.debug("[TTS] SPEAK_COMPLETE");
        });

        (input as any).wsaTTS.speak(utterance);
      }
    }),
  },
  guards: {
    bufferContainsUtterancePartReadyToBeSpoken: ({ context }) => {
      const m = context.buffer.match(UTTERANCE_CHUNK_REGEX);

      return !!m;
    },
    bufferIsNonEmpty: ({ context }) => {
      return !!context.buffer;
    },
  },
  delays: {
    FILLER_DELAY: ({ context }) => {
      return context.agenda.fillerDelay;
    },
  },
}).createMachine({
  id: "tts",
  context: ({ input }) => ({
    ttsDefaultVoice: input.ttsDefaultVoice || "en-US-DavisNeural",
    ttsLexicon: input.ttsLexicon,
    audioContext: input.audioContext,
    azureCredentials: input.azureCredentials,
    azureRegion: input.azureRegion,
    buffer: "",
  }),
  initial: "GetToken",
  on: {
    READY: {
      target: ".Ready",
      actions: [
        assign({
          wsaTTS: ({ event }) => event.value.wsaTTS,
          wsaUtt: ({ event }) => event.value.wsaUtt,
        }),
        sendParent({ type: "TTS_READY" }),
      ],
    },
    ERROR: { actions: sendParent({ type: "TTS_ERROR" }) },
  },
  states: {
    Ready: {
      initial: "Idle",
      states: {
        Idle: {
          on: {
            SPEAK: [
              {
                target: "BufferedSpeaker",
                guard: ({ event }) => !!event.value.stream,
                actions: assign({
                  agenda: ({ event }) =>
                    event.value.fillerDelay
                      ? event.value
                      : { ...event.value, fillerDelay: 500 },
                }),
              },
              {
                target: "Speaking",
                actions: assign({ agenda: ({ event }) => event.value }),
              },
            ],
          },
        },
        BufferedSpeaker: {
          type: "parallel",
          invoke: {
            id: "createEventsFromStream",
            src: "createEventsFromStream",
            input: ({ context }) => context.agenda,
          },
          on: {
            STOP: {
              target: "Idle",
            },
            SPEAK_COMPLETE: [
              {
                guard: stateIn("#BufferingDone"),
                target: "Idle",
                actions: [sendParent({ type: "SPEAK_COMPLETE" })],
              },
            ],
          },
          states: {
            Buffer: {
              initial: "BufferIdle",
              on: {
                STREAMING_SET_VOICE: {
                  actions: "assignCurrentVoice",
                },
                STREAMING_SET_PERSONA: {
                  actions: "sendParentCurrentPersona",
                },
              },
              states: {
                BufferIdle: {
                  id: "BufferIdle",
                  entry: [
                    ({ event }) => console.debug("=== Entry BufferIdle", event),
                  ],
                  on: {
                    STREAMING_CHUNK: {
                      actions: [
                        ({ event }) =>
                          console.debug(
                            "=================STREAMING_CHUNK: BufferIdle => Buffering",
                            event,
                          ),
                      ],

                      target: "Buffering",
                    },
                  },
                },
                Buffering: {
                  id: "Buffering",
                  on: {
                    STREAMING_CHUNK: [
                      {
                        actions: [
                          ({ event }) =>
                            console.debug(
                              "=================STREAMING_CHUNK: Buffering => Buffering",
                              event,
                            ),
                        ],
                        target: "Buffering",
                        reenter: true,
                      },
                    ],
                    STREAMING_DONE: [
                      {
                        target: "BufferingDone",
                        actions: [
                          ({ event }) =>
                            console.debug(
                              "=================STREAMING_DONE: Buffering => BufferingDone",
                              event,
                            ),
                        ],
                      },
                    ],
                  },
                  entry: [
                    ({ event }) => console.debug("=== Entry Buffering", event),
                    assign({
                      buffer: ({ context, event }) =>
                        context.buffer + (event as any).value,
                    }),
                  ],
                },
                BufferingDone: {
                  entry: [
                    ({ event }) =>
                      console.debug("=== Entry BufferingDone", event),
                  ],

                  id: "BufferingDone",
                },
              },
            },
            Speaker: {
              initial: "SpeakingIdle",
              states: {
                SpeakingIdle: {
                  entry: [
                    ({ event }) =>
                      console.debug("=== Entry SpeakingIdle", event),
                  ],
                  always: [
                    {
                      target: "Speak",
                      guard: stateIn("#BufferingDone"),
                      actions: [
                        ({ event }) =>
                          console.debug(
                            "========== in BufferingDone: SpeakingIdle => Speak",
                            event,
                          ),
                        assign({
                          utteranceFromStream: ({ context }) => context.buffer,
                        }),
                        assign({
                          buffer: "",
                        }),
                      ],
                    },
                    {
                      target: "PrepareSpeech",
                      guard: "bufferContainsUtterancePartReadyToBeSpoken",
                    },
                  ],
                  after: {
                    FILLER_DELAY: {
                      target: "SpeakingIdle",
                      reenter: true,
                      actions: "addFiller",
                      guard: ({ context }) => context.buffer.includes(" "),
                    },
                  },
                },
                PrepareSpeech: {
                  entry: [
                    ({ event }) =>
                      console.debug("=== Entry PrepareSpeech", event),
                    assign(({ context }) => {
                      let utterancePart: string;
                      let restOfBuffer: string;
                      const match = context.buffer.match(UTTERANCE_CHUNK_REGEX);
                      utterancePart = match![0];
                      restOfBuffer = context.buffer.substring(
                        utterancePart.length,
                      );

                      return {
                        buffer: restOfBuffer,
                        utteranceFromStream: utterancePart,
                      };
                    }),
                  ],
                  always: [
                    {
                      target: "Speak",
                    },
                  ],
                },
                Speak: {
                  entry: [
                    ({ event }) => console.debug("=== Entry Speak", event),
                  ],
                  initial: "Go",
                  on: {
                    TTS_STARTED: {
                      actions: sendParent({ type: "TTS_STARTED" }),
                    },
                    SPEAK_COMPLETE: [
                      {
                        guard: stateIn("#Buffering"),
                        target: "SpeakingIdle",
                      },
                      {
                        guard: "bufferIsNonEmpty",
                        target: "SpeakingIdle",
                      },
                    ],
                  },
                  states: {
                    Go: {
                      invoke: {
                        src: "start",
                        input: ({ context }) => ({
                          wsaTTS: context.wsaTTS,
                          wsaUtt: context.wsaUtt,
                          ttsLexicon: context.ttsLexicon,
                          voice:
                            context.currentVoice ||
                            context.agenda.voice ||
                            context.ttsDefaultVoice,
                          utterance: context.utteranceFromStream,
                        }),
                      },
                      on: {
                        CONTROL: "Paused",
                      },
                      exit: "ttsStop",
                    },
                    Paused: {
                      on: {
                        CONTROL: "Go",
                      },
                    },
                  },
                },
              },
            },
          },
        },

        Speaking: {
          initial: "Go",
          on: {
            STOP: {
              target: "Idle",
            },
            TTS_STARTED: {
              actions: sendParent({ type: "TTS_STARTED" }),
            },
            SPEAK_COMPLETE: {
              target: "Idle",
            },
          },
          exit: sendParent({ type: "SPEAK_COMPLETE" }),
          states: {
            Go: {
              invoke: {
                src: "start",
                input: ({ context }) => ({
                  wsaTTS: context.wsaTTS,
                  wsaUtt: context.wsaUtt,
                  ttsLexicon: context.ttsLexicon,
                  voice: context.agenda.voice || context.ttsDefaultVoice,
                  // streamURL: context.agenda.streamURL,
                  utterance: context.agenda.utterance,
                }),
              },
              on: {
                CONTROL: "Paused",
              },
              exit: "ttsStop",
            },
            Paused: {
              on: {
                CONTROL: "Go",
              },
            },
          },
        },
      },
    },
    Fail: {},
    GetToken: {
      invoke: {
        id: "getAuthorizationToken",
        input: ({ context }) => ({
          credentials: context.azureCredentials,
        }),
        src: "getToken",
        onDone: {
          target: "Ponyfill",
          actions: [
            assign(({ event }) => {
              return { azureAuthorizationToken: event.output };
            }),
          ],
        },
        onError: {
          actions: [
            raise({ type: "ERROR" }),
            ({ event }) => console.error("[TTS] getToken error", event),
          ],
          target: "Fail",
        },
      },
    },
    Ponyfill: {
      invoke: {
        id: "ponyTTS",
        src: "ponyfill",
        input: ({ context }) => ({
          audioContext: context.audioContext,
          azureAuthorizationToken: context.azureAuthorizationToken,
          azureRegion: context.azureRegion,
        }),
      },
    },
  },
});

const wrapSSML = (
  text: string,
  voice: string,
  lexicon: string,
  speechRate: number,
): string => {
  let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}">`;
  if (lexicon) {
    content = content + `<lexicon uri="${lexicon}"/>`;
  }
  content =
    content +
    `<prosody rate="${speechRate}">` +
    `${text}</prosody></voice></speak>`;
  return content;
};
