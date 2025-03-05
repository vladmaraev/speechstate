import {
  setup,
  sendParent,
  assign,
  fromCallback,
  stateIn,
  fromPromise,
  and,
  not,
} from "xstate";

import {
  Agenda,
  TTSInit,
  TTSEvent,
  TTSContext,
  TTSPonyfillInput,
  ConstructableSpeechSynthesisUtterance,
} from "./types";

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
    checkCache: fromPromise<
      any,
      { cacheURL: string; utterance: string; voice: string; locale: string }
    >(async ({ input }) => {
      const response = fetch(input.cacheURL + "check-tts", {
        method: "POST",
        body: JSON.stringify({
          utterance: input.utterance,
          voice: input.voice,
          locale: input.locale.replace("-", "_"),
        }),
      }).then((res) => res.json());
      return response;
    }),
    getAudioFromCache: fromPromise<
      any,
      {
        audioContext: AudioContext;
        cacheURL: string;
        utterance: string;
        voice: string;
        locale: string;
      }
    >(async ({ input }) => {
      const audioCtx = input.audioContext;
      const response = await fetch(input.cacheURL + "generate-tts", {
        method: "POST",
        body: JSON.stringify({
          utterance: input.utterance,
          voice: input.voice,
          locale: input.locale.replace("-", "_"),
        }),
      })
        .then((res) => res.json())
        .then((json) => json.tts_data)
        .then((data) => data.slice(2, -1))
        .then(
          (raw) => Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)).buffer,
        );
      let buffer = await audioCtx.decodeAudioData(response);
      console.debug("[tts.getAudioFromCache] has received data");
      return buffer;
    }),
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
        source.addEventListener("ended", () => {
          sendBack({ type: "SPEAK_COMPLETE" });
          console.debug("[TTS] SPEAK_COMPLETE (audio)");
        });
      },
    ),
    createEventsFromStream: fromCallback(
      ({ sendBack, input }: { sendBack: any; input: Agenda }) => {
        const eventSource = new EventSource(input.stream);
        eventSource.addEventListener("STREAMING_DONE", (_event) => {
          sendBack({ type: "STREAMING_DONE" });
          eventSource.close();
        });
        eventSource.addEventListener("STREAMING_RESET", (_event) => {});
        eventSource.addEventListener("STREAMING_CHUNK", (event) => {
          sendBack({ type: "STREAMING_CHUNK", value: event.data });
        });
        eventSource.addEventListener("STREAMING_SET_VOICE", (event) => {
          sendBack({ type: "STREAMING_SET_VOICE", value: event.data });
        });
        eventSource.addEventListener("STREAMING_SET_PERSONA", (event) => {
          sendBack({ type: "STREAMING_SET_PERSONA", value: event.data });
        });
      },
    ),
    ponyfill: fromCallback<null, TTSPonyfillInput>(({ sendBack, input }) => {
      const ponyfill = createSpeechSynthesisPonyfill({
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
      const wsaTTS = input.wsaTTS;
      const wsaUtt = input.wsaUtt;

      if (["", " "].includes(input.utterance)) {
        console.debug("[TTS] SPEAK: (empty utterance)");
        sendBack({ type: "SPEAK_COMPLETE" });
      } else {
        const content = wrapSSML(
          input.utterance,
          input.voice,
          input.locale,
          input.ttsLexicon,
          1,
        ); // todo speech rate;
        const utterance = new wsaUtt(content);
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
        wsaTTS.speak(utterance);
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
    /** delay between chunks after which the filler is produced */
    FILLER_DELAY: ({ context }) => {
      return context.agenda.fillerDelay;
    },
    /** maximum time between chunks */
    STREAMING_TIMEOUT: 10_000,
  },
}).createMachine({
  id: "tts",
  context: ({ input }) => ({
    azureAuthorizationToken: input.azureAuthorizationToken,
    ttsDefaultVoice: input.ttsDefaultVoice || "en-US-DavisNeural",
    ttsLexicon: input.ttsLexicon,
    audioContext: input.audioContext,
    azureRegion: input.azureRegion,
    locale: input.locale || "en-US",
    buffer: "",
  }),
  on: {
    ERROR: { actions: sendParent({ type: "TTS_ERROR" }) },
  },
  type: "parallel",
  states: {
    Operation: {
      initial: "NotReady",
      states: {
        NotReady: {
          on: {
            READY: {
              target: "Ready",
              actions: [
                assign(({ event }) => {
                  return {
                    wsaTTS: event.value.wsaTTS,
                    wsaUtt: event.value.wsaUtt,
                  };
                }),
                sendParent({ type: "TTS_READY" }),
              ],
            },
          },
        },
        Ready: {
          initial: "Idle",
          states: {
            Idle: {
              id: "Idle",
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
                      on: {
                        STREAMING_CHUNK: {
                          target: "Buffering",
                        },
                      },
                    },
                    Buffering: {
                      id: "Buffering",
                      on: {
                        STREAMING_CHUNK: {
                          target: "Buffering",
                          reenter: true,
                        },
                        STREAMING_DONE: "BufferingDone",
                      },
                      after: {
                        STREAMING_TIMEOUT: {
                          target: "BufferingDone",
                          actions: () =>
                            console.error(
                              "[TTS] timeout, STREAMING_DONE event was not received from SSE",
                            ),
                        },
                      },
                      entry: [
                        assign({
                          buffer: ({ context, event }) =>
                            context.buffer + (event as any).value,
                        }),
                      ],
                    },
                    BufferingDone: {
                      id: "BufferingDone",
                      type: "final",
                    },
                  },
                },
                Speaker: {
                  initial: "SpeakingIdle",
                  states: {
                    SpeakingIdle: {
                      id: "SpeakingIdle",
                      always: [
                        {
                          target: "Speak",
                          guard: stateIn("#BufferingDone"),
                          actions: [
                            assign({
                              utteranceFromStream: ({ context }) =>
                                context.buffer,
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
                        assign(({ context }) => {
                          let utterancePart: string;
                          let restOfBuffer: string;
                          const match = context.buffer.match(
                            UTTERANCE_CHUNK_REGEX,
                          );
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
                      initial: "Init",
                      states: {
                        Init: {
                          always: [
                            {
                              target: "CheckCache",
                              guard: ({ context }) => !!context.agenda.cache,
                            },
                            { target: "Go" },
                          ],
                        },
                        CheckCache: {
                          invoke: {
                            src: "checkCache",
                            input: ({ context }) => ({
                              cacheURL: context.agenda.cache,
                              utterance: context.utteranceFromStream,
                              voice:
                                context.currentVoice ||
                                context.agenda.voice ||
                                context.ttsDefaultVoice,
                              locale: context.locale,
                            }),
                            onError: "Go",
                            onDone: [
                              {
                                target: "UseCache",
                                guard: ({ event }) => event.output.blob_exists,
                                actions: ({ event }) =>
                                  console.debug(
                                    "[TTS CheckCache] cache exists",
                                    event.output,
                                  ),
                              },
                              {
                                target: "Go",
                                actions: ({ event }) =>
                                  console.debug(
                                    "[TTS CheckCache] cache does not exist",
                                    event.output,
                                  ),
                              },
                            ],
                          },
                        },
                        UseCache: {
                          initial: "GetAudio",
                          states: {
                            GetAudio: {
                              invoke: {
                                src: "getAudioFromCache",
                                input: ({ context }) => ({
                                  audioContext: context.audioContext,
                                  cacheURL: context.agenda.cache,
                                  utterance: context.utteranceFromStream,
                                  voice:
                                    context.currentVoice ||
                                    context.agenda.voice ||
                                    context.ttsDefaultVoice,
                                  locale: context.locale,
                                }),
                                onDone: {
                                  target: "PlayAudio",
                                  actions: assign(({ event }) => {
                                    return {
                                      audioBuffer: event.output,
                                    };
                                  }),
                                },
                                onError: "#TtsStreamGo",
                              },
                            },
                            PlayAudio: {
                              invoke: {
                                src: "playAudio",
                                input: ({ context }) => ({
                                  audioBuffer: context.audioBuffer,
                                  audioContext: context.audioContext,
                                }),
                              },
                              on: {
                                CONTROL: "PausedAudio",
                                SPEAK_COMPLETE: [
                                  {
                                    target: "#SpeakingDone",
                                    guard: and([
                                      stateIn("#BufferingDone"),
                                      not("bufferIsNonEmpty"),
                                    ]),
                                  },
                                  { target: "#SpeakingIdle" },
                                ],
                                TTS_STARTED: {
                                  actions: [
                                    sendParent({ type: "TTS_STARTED" }),
                                    assign(({ event }) => {
                                      return {
                                        audioBufferSourceNode: event.value,
                                      };
                                    }),
                                  ],
                                },
                              },
                              exit: "ttsStop",
                            },
                            PausedAudio: {
                              on: {
                                CONTROL: "PlayAudio",
                              },
                            },
                          },
                        },
                        Go: {
                          id: "TtsStreamGo",
                          entry: ({ context }) =>
                            console.debug(
                              "[TTS] SPEAK (not cached): ",
                              context.utteranceFromStream,
                            ),
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
                            SPEAK_COMPLETE: [
                              {
                                target: "#SpeakingDone",
                                guard: and([
                                  stateIn("#BufferingDone"),
                                  not("bufferIsNonEmpty"),
                                ]),
                              },
                              { target: "#SpeakingIdle" },
                            ],
                            TTS_STARTED: {
                              actions: sendParent({ type: "TTS_STARTED" }),
                            },
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
                    SpeakingDone: {
                      id: "SpeakingDone",
                      type: "final",
                    },
                  },
                },
              },
              onDone: {
                target: "Idle",
                actions: sendParent({ type: "SPEAK_COMPLETE" }),
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
                      target: "#Speaking",
                    },
                  },
                },
                PlayAudio: {
                  entry: ({ context }) =>
                    console.debug(
                      "[TTS] SPEAK (cached): ",
                      context.utteranceFromStream,
                    ),
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
              id: "Speaking",
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
                  entry: ({ context }) =>
                    console.debug("[TTS] SPEAK:", context.utteranceFromStream),
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
      },
    },
    HandleNewTokens: {
      initial: "Ponyfill",
      states: {
        Ponyfill: {
          invoke: {
            id: "ponyTTS",
            src: "ponyfill",
            input: ({ context }) => ({
              azureAuthorizationToken: context.azureAuthorizationToken,
              azureRegion: context.azureRegion,
            }),
          },

          on: {
            READY: {
              actions: [
                assign({
                  wsaTTS: ({ event }) => event.value.wsaTTS,
                  wsaUtt: ({ event }) => event.value.wsaUtt,
                }),
              ],
            },
            NEW_TOKEN: {
              target: "Ponyfill",
              reenter: true,
            },
          },
        },
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
