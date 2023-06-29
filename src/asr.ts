import {
  createMachine,
  sendParent,
  assign,
  fromCallback,
  raise,
  cancel,
} from "xstate";
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
      locale: input.locale || "en-US",
      audioContext: input.audioContext,
      azureCredentials: input.azureCredentials,
    }),

    initial: "GetToken",
    on: {
      READY: {
        target: ".Ready",
        actions: [
          assign({
            wsaASR: ({ event }) => event.value.wsaASR,
            wsaGrammarList: ({ event }) => event.value.wsaGrammarList,
          }),
          sendParent({ type: "ASR_READY" }),
        ],
      },
    },
    states: {
      Fail: {},
      Ready: {
        on: {
          START: {
            target: "Recognising",
            actions: assign({ params: ({ event }) => event.value }),
          },
        },
      },
      Recognising: {
        initial: "waitForRecogniser",
        invoke: {
          id: "recStart",
          input: ({ context }) => ({
            wsaASR: context.wsaASR,
            wsaGrammarList: context.wsaGrammarList,
            locale: context.locale,
            phrases: (context.params || {}).phrases || [],
          }),
          src: "recStart",
        },
        exit: "recStop",
        on: {
          RESULT: {
            actions: [
              assign({
                result: ({ event }) => event.value,
              }),
              cancel("completeTimeout"),
            ],
            target: ".Match",
          },
          RECOGNISED: {
            target: "Ready",
            actions: [
              sendParent(({ context }) => ({
                type: "RECOGNISED",
                value: context.result,
              })),
            ],
          },
          PAUSE: {
            target: "Pause",
          },
          NOINPUT: {
            actions: sendParent({ type: "ASR_NOINPUT_TIMEOUT" }),
            target: "Ready",
          },
        },
        states: {
          WaitForRecogniser: {
            on: {
              STARTED: {
                target: "NoInput",
                actions: [
                  assign({
                    wsaASRinstance: ({ event }) => event.value.wsaASRinstance,
                  }),
                  sendParent({ type: "ASR_STARTED" }),
                ],
              },
            },
          },
          NoInput: {
            entry: [
              raise(
                { type: "NOINPUT" },
                {
                  delay: ({ context }) =>
                    (context.params || {}).noInputTimeout ||
                    context.asrDefaultNoInputTimeout,
                  id: "timeout",
                }
              ),
            ],
            on: {
              STARTSPEECH: {
                target: "InProgress",
                actions: cancel("completeTimeout"),
              },
            },
            exit: [cancel("timeout")],
          },
          InProgress: {
            entry: () => console.debug("[ASR] in progress"),
          },
          Match: {
            entry: raise(
              { type: "RECOGNISED" },
              {
                delay: ({ context }) =>
                  (context.params || {}).completeTimeout ||
                  context.asrDefaultCompleteTimeout,
                id: "completeTimeout",
              }
            ),
          },
        },
      },
      Pause: {
        entry: sendParent({ type: "ASR_PAUSED" }),
        on: {
          CONTINUE: {
            target: "Recognising",
            //       ///// todo? reset noInputTimeout
            //       // actions: assign({
            //       //   params: {
            //       //     noInputTimeout: ({ context }) =>
            //       //       context.asrDefaultNoInputTimeout,
            //       //     completeTimeout: 0,
            //       //     locale: "0",
            //       //     hints: [""],
            //       //   },
            //       // }),} },
          },
        },
      },
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
            target: "Fail",
          },
        },
      },
      Ponyfill: {
        invoke: {
          id: "ponyASR",
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
    actions: {
      recStop: ({ context }) => {
        context.wsaASRinstance.abort();
        console.debug("[ASR] stopped");
      },
    },
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
        sendBack({
          type: "READY",
          value: {
            wsaASR: SpeechRecognition,
            wsaGrammarList: SpeechGrammarList,
          },
        });
        console.debug("[ASR] READY");
      }),
      recStart: fromCallback((sendBack, _receive, { input }) => {
        let asr = new input.wsaASR!();
        asr.grammars = new input.wsaGrammarList!();
        asr.grammars.phrases = input.phrases || [];
        asr.lang = input.locale;
        asr.continuous = true;
        asr.interimResults = true;
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
            const res: Hypothesis[] = [
              {
                utterance: transcript,
                confidence: confidence,
              },
            ];
            sendBack({
              type: "RESULT",
              value: res,
            });
            console.debug("[ASR] RESULT (pre-final)", res);
          } else {
            sendBack({ type: "STARTSPEECH" });
          }
        };
        asr.addEventListener("start", () => {
          sendBack({ type: "STARTED", value: { wsaASRinstance: asr } });
        });

        // receive((event) => {
        //   console.debug("bla");
        //   if (event.type === "STOP") {
        //     asr.abort();
        //   }
        // });
        asr.start();
      }),
    },
  }
);
