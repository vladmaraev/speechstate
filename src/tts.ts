import { setup, sendParent, assign, fromCallback, stateIn } from "xstate";

import { getToken } from "./getToken";
import createSpeechSynthesisPonyfill from "@davi-ai/web-speech-cognitive-services-davi";
import type {
  SpeechSynthesisUtterance,
  SpeechSynthesisEventProps,
} from "@davi-ai/web-speech-cognitive-services-davi";

import { AzureSpeechCredentials, Agenda } from "./types";

interface ConstructableSpeechSynthesisUtterance
  extends SpeechSynthesisUtterance {
  new (s: string);
}

interface TTSInit {
  audioContext: AudioContext;
  azureCredentials: string | AzureSpeechCredentials;
  azureRegion: string;
  ttsDefaultVoice: string;
  ttsLexicon?: string;
}

interface TTSContext extends TTSInit {
  azureAuthorizationToken?: string;
  wsaTTS?: SpeechSynthesis;
  wsaVoice?: SpeechSynthesisVoice;
  wsaUtt?: ConstructableSpeechSynthesisUtterance;
  agenda?: Agenda;
  buffer?: string;
  utteranceFromStream?: string;
}

interface TTSPonyfillInput {
  audioContext: AudioContext;
  azureRegion: string;
  azureAuthorizationToken: string;
}

type TTSEvent =
  | { type: "PREPARE" }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | {
      type: "READY";
      value: {
        wsaTTS: SpeechSynthesis;
        wsaUtt: ConstructableSpeechSynthesisUtterance;
      };
    }
  | { type: "ERROR" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "TTS_STARTED" }
  | { type: "STREAMING_CHUNK"; value: string }
  | { type: "STREAMING_DONE" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "VISEME"; value: SpeechSynthesisEventProps };

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
  },
  actors: {
    getToken: getToken,
    createEventsFromStream: fromCallback(
      ({ sendBack, input }: { sendBack: any; input: Agenda }) => {
        const eventSource = new EventSource(input.stream);
        eventSource.addEventListener("STREAMING_DONE", (_event) => {
          console.log("received streaming done - closing event stream");
          sendBack({ type: "STREAMING_DONE" });
          eventSource.close();
        });
        eventSource.addEventListener("STREAMING_RESET", (_event) => {
          console.log("received streaming reset");
        });
        eventSource.addEventListener("STREAMING_CHUNK", (event) => {
          console.log("received streaming chunk:", event);
          sendBack({ type: "STREAMING_CHUNK", value: event.data });
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
      tts.onvoiceschanged = () => {
        const voices = tts.getVoices();
        if (voices.length > 0) {
          console.debug("[TTS] READY", tts);
          sendBack({
            type: "READY",
            value: { wsaTTS: tts, wsaUtt: ttsUtterance },
          });
        } else {
          console.error("[TTS] No voices available");
          sendBack({ type: "ERROR" });
        }
      };
    }),
    start: fromCallback<
      null,
      {
        utterance: string;
        voice: string;
        ttsLexicon: string;
        wsaUtt: ConstructableSpeechSynthesisUtterance;
        wsaTTS: SpeechSynthesis;
      }
    >(({ sendBack, input }) => {
      if (["", " "].includes(input.utterance)) {
        console.debug("[TTS] SPEAK: (empty utterance)");
        sendBack({ type: "SPEAK_COMPLETE" });
      } else {
        console.debug("[TTS] SPEAK: ", input.utterance);
        const content = wrapSSML(
          input.utterance,
          input.voice,
          input.ttsLexicon,
        );
        let visemeStart = 0;
        const utterance = new input.wsaUtt(content);
        utterance.onsynthesisstart = () => {
          sendBack({ type: "TTS_STARTED" });
          console.debug("[TTS] TTS_STARTED");
        };
        utterance.onend = () => {
          sendBack({ type: "SPEAK_COMPLETE" });
          console.debug("[TTS] SPEAK_COMPLETE");
        };
        utterance.onviseme = (event: SpeechSynthesisEventProps) => {
          const name = event.name;
          const fromStart = event.elapsedTime / 1e6;
          sendBack({
            type: "VISEME",
            value: { name: name, frames: [visemeStart, fromStart] },
          });
          visemeStart = event.elapsedTime / 1e6;
        };
        input.wsaTTS.speak(utterance);
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
                            context.agenda.voice || context.ttsDefaultVoice,
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
            VISEME: {
              actions: sendParent(({ event }) => ({
                type: "VISEME",
                value: event.value,
              })),
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
          actions: ({ event }) => console.error("[TTS] getToken error", event),
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

const wrapSSML = (text: string, voice: string, lexicon: string): string => {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"  xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${voice}">
  ${lexicon ? `<lexicon uri="${lexicon}"/>` : ""}
  ${text}\n    </voice>\n</speak>\n`;
};
