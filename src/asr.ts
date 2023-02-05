import { createMachine, sendParent, assign, fromCallback } from "xstate";
import { getToken } from "./getToken";

import createSpeechRecognitionPonyfill from "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

const REGION = "northeurope";

export const asrMachine = createMachine(
  {
    id: "asr",
    types: {
      context: {} as ASRContext,
      events: {} as ASREvent,
    },
    context: ({ input }) => ({
      asrDefaultCompleteTimeout: input.asrDefaultCompleteTimeout || 0,
      asrDefaultNoInputTimeout: input.asrDefaultNoInputTimeout || 5000,
      language: input.locale || "en-US",
      audioContext: input.audioContext,
      azureCredentials: input.azureCredentials,
    }),

    initial: "getToken",
    on: {
      READY: {
        target: ".ready",
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
      ready: {
        on: {
          START: {
            target: "speaking",
            actions: assign({ agenda: ({ event }) => event.value }),
          },
        },
      },
      fail: {},
      getToken: {
        invoke: {
          id: "getAuthorizationToken",
          input: ({ context }) => ({
            credentials: context.azureCredentials,
          }),
          src: "getToken",
          onDone: {
            target: "ponyfill",
            actions: [
              assign(({ event }) => {
                return { azureAuthorizationToken: event.output };
              }),
            ],
          },
          onError: {
            target: "fail",
          },
        },
      },
      ponyfill: {
        invoke: {
          id: "ponyTTS",
          src: "ponyfill",
          input: ({ context }) => ({
            audioContext: context.audioContext,
            azureAuthorizationToken: context.azureAuthorizationToken,
            voice: context.ttsVoice,
          }),
        },
      },
    },
  },
  {
    actors: {
      getToken: getToken,
      ponyfill: fromCallback((sendBack, _receive, { input }) => {
        const { SpeechGrammarList, SpeechRecognition } =
          createSpeechRecognitionPonyfill({
            audioContext: input.audioContext,
            credentials: {
              region: REGION, // TODO
              authorizationToken: input.azureAuthorizationToken,
            },
          });
        const asr = new SpeechRecognition();
        asr.grammars = new SpeechGrammarList();
        asr.lang = "en-US";
        asr.continuous = true;
        asr.interimResults = true;
        asr.onstart = function (_event: any) {
          sendBack({ type: "ASR_START" });
        };
        asr.onresult = function (event: any) {
          if (event.results[event.results.length - 1].isFinal) {
            const transcript = event.results
              .map((x: SpeechRecognitionResult) =>
                x[0].transcript.replace(/\.$/, "")
              )
              .join(" ");
            const confidence =
              event.results
                .map((x: SpeechRecognitionResult) => x[0].confidence)
                .reduce((a: number, b: number) => a + b) / event.results.length;
            sendBack({
              type: "ASRRESULT",
              value: [
                {
                  utterance: transcript,
                  confidence: confidence,
                },
              ],
            });
          } else {
            sendBack({ type: "STARTSPEECH" });
          }
        };
        sendBack({
          type: "READY",
          value: { wsaASR: asr },
        });
      }),
    },
  }
);
