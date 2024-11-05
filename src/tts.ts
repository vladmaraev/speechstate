import {
  setup,
  sendParent,
  assign,
  fromCallback,
  stateIn,
  raise,
  fromPromise,
} from "xstate";

import {
  Agenda,
  TTSInit,
  TTSEvent,
  TTSContext,
  TTSPonyfillInput,
  ConstructableSpeechSynthesisUtterance,
} from "./types";

import { getToken } from "./getToken";

import createSpeechSynthesisPonyfill from "@vladmaraev/web-speech-cognitive-services-davi";
import type { SpeechSynthesisEventProps } from "@vladmaraev/web-speech-cognitive-services-davi";

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
      if (context.audioBufferSourceNode) {
        context.audioBufferSourceNode.stop();
      }
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
    getAudio: fromPromise<
      any,
      { audioContext: AudioContext; audioURL: string }
    >(async ({ input }) => {
      const response = await fetch(input.audioURL);
      const audioCtx = input.audioContext;
      let buffer = audioCtx.decodeAudioData(await response.arrayBuffer());
      return buffer;
    }),
    playAudio: fromCallback(
      ({
        sendBack,
        input,
      }: {
        sendBack: any;
        input: { audioContext: AudioContext; audioBuffer: AudioBuffer };
      }) => {
        let source = input.audioContext.createBufferSource();
        source.buffer = input.audioBuffer;
        source.connect(input.audioContext.destination);
        source.start();
        sendBack({ type: "TTS_STARTED", value: source });
        source.addEventListener("ended", (event) => {
          sendBack({ type: "SPEAK_COMPLETE" });
          console.debug("[TTS] SPEAK_COMPLETE (audio)");
        });
      },
    ),
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
      tts.onvoiceschanged = () => {
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
      };
    }),
    start: fromCallback<
      null,
      {
        utterance: string;
        voice: string;
        ttsLexicon: string;
        locale: string;
        wsaUtt: ConstructableSpeechSynthesisUtterance;
        wsaTTS: SpeechSynthesis;
        visemes?: boolean;
      }
    >(({ sendBack, input }) => {
      console.debug("[TTS.start] with input", input);
      if (["", " "].includes(input.utterance)) {
        console.debug("[TTS] SPEAK: (empty utterance)");
        sendBack({ type: "SPEAK_COMPLETE" });
      } else {
        console.debug("[TTS] SPEAK: ", input.utterance);
        const content = wrapSSML(
          input.utterance,
          input.voice,
          input.locale,
          input.ttsLexicon,
          1,
        ); // todo speech rate;
        const utterance = new input.wsaUtt(content);
        utterance.onsynthesisstart = () => {
          sendBack({ type: "TTS_STARTED" });
          console.debug("[TTS] TTS_STARTED");
        };
        utterance.onend = () => {
          sendBack({ type: "SPEAK_COMPLETE" });
          console.debug("[TTS] SPEAK_COMPLETE");
        };
        if (input.visemes) {
          utterance.onviseme = (event: SpeechSynthesisEventProps) => {
            sendBack({
              type: "VISEME",
              value: event,
            });
          };
        }
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
    locale: input.locale || "en-US",
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
                target: "Playing",
                guard: ({ event }) => !!event.value.audioURL,
                actions: assign({ agenda: ({ event }) => event.value }),
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
                          visemes: context.agenda.visemes,
                          voice:
                            context.currentVoice ||
                            context.agenda.voice ||
                            context.ttsDefaultVoice,
                          locale: context.locale,
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
                        SPEAK_COMPLETE: {},
                        CONTROL: "Go",
                      },
                    },
                  },
                },
              },
            },
          },
        },

        Playing: {
          on: {
            SPEAK_COMPLETE: {
              target: "Idle",
            },
            TTS_STARTED: {
              actions: [
                sendParent({ type: "TTS_STARTED" }),
                assign(({ event }) => {
                  return { audioBufferSourceNode: event.value };
                }),
              ],
            },
            STOP: {
              actions: () => console.log("STOP"),
              target: "Idle",
            },
          },
          initial: "FetchAudio",
          states: {
            FetchAudio: {
              invoke: {
                src: "getAudio",
                input: ({ context }) => ({
                  audioContext: context.audioContext,
                  audioURL: context.agenda.audioURL,
                }),
                onDone: {
                  target: "PlayAudio",
                  actions: assign(({ event }) => {
                    return { audioBuffer: event.output };
                  }),
                },
                onError: {
                  target: "#tts.Ready.Speaking",
                },
              },
            },
            PlayAudio: {
              invoke: {
                src: "playAudio",
                input: ({ context }) => ({
                  audioContext: context.audioContext,
                  audioBuffer: context.audioBuffer,
                }),
              },
              on: {
                CONTROL: "AudioPaused",
              },
              exit: "ttsStop",
            },
            AudioPaused: {
              on: {
                CONTROL: "PlayAudio",
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
              actions: sendParent(
                ({ event }: { event: { type: "VISEME"; value: any } }) => ({
                  type: "VISEME",
                  value: event.value,
                }),
              ),
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
                  visemes: context.agenda.visemes,
                  // streamURL: context.agenda.streamURL,
                  locale: context.locale,
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
                SPEAK_COMPLETE: {},
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
  locale: string,
  lexicon: string,
  speechRate: number,
): string => {
  let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"><lang xml:lang="${locale}">`;
  if (lexicon) {
    content = content + `<lexicon uri="${lexicon}"/>`;
  }
  content =
    content +
    `<prosody rate="${speechRate}">` +
    `${text}</prosody></lang></voice></speak>`;
  return content;
};
