import {
  setup,
  sendParent,
  assign,
  fromCallback,
  fromPromise,
  raise,
  cancel,
} from "xstate";
import { getToken } from "./getToken";

import createSpeechRecognitionPonyfill from "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";
const REGION = "northeurope";

import {
  RecogniseParameters,
  Hypothesis,
  AzureSpeechCredentials,
  AzureLanguageCredentials,
} from "./types";

interface MySpeechRecognition extends SpeechRecognition {
  new ();
}
interface MySpeechGrammarList extends SpeechGrammarList {
  new ();
}

type ASREvent =
  | {
      type: "READY";
      value: {
        wsaASR: MySpeechRecognition;
        wsaGrammarList: MySpeechGrammarList;
      };
    }
  | { type: "ERROR" }
  | { type: "NOINPUT" }
  | { type: "CONTROL" }
  | {
      type: "START";
      value?: RecogniseParameters;
    }
  | { type: "STARTED"; value: { wsaASRinstance: MySpeechRecognition } }
  | { type: "STARTSPEECH" }
  | { type: "RECOGNISED" }
  | { type: "RESULT"; value: Hypothesis[] };

interface ASRContext extends ASRInit {
  azureAuthorizationToken?: string;
  wsaASR?: MySpeechRecognition;
  wsaASRinstance?: MySpeechRecognition;
  wsaGrammarList?: MySpeechGrammarList;
  result?: Hypothesis[];
  nluResult?: any; // TODO
  params?: RecogniseParameters;
}

interface ASRInit {
  asrDefaultCompleteTimeout: number;
  asrDefaultNoInputTimeout: number;
  locale: string;
  audioContext: AudioContext;
  azureCredentials: string | AzureSpeechCredentials;
  speechRecognitionEndpointId?: string;
  azureLanguageCredentials?: AzureLanguageCredentials;
}

export const asrMachine = setup({
  types: {
    context: {} as ASRContext,
    events: {} as ASREvent,
    input: {} as ASRInit,
  },
  actions: {
    recStop: ({ context }) => {
      context.wsaASRinstance.abort();
      console.debug("[ASR] stopped");
    },
  },
  actors: {
    getToken: getToken,
    ponyfill: fromCallback(({ sendBack, input }) => {
      const { SpeechGrammarList, SpeechRecognition } =
        createSpeechRecognitionPonyfill({
          audioContext: (input as any).audioContext,
          speechRecognitionEndpointId: (input as any)
            .speechRecognitionEndpointId,
          credentials: {
            region: REGION, // TODO
            authorizationToken: (input as any).azureAuthorizationToken,
          },
        });
      sendBack({
        type: "READY",
        value: {
          wsaASR: SpeechRecognition,
          wsaGrammarList: SpeechGrammarList,
        },
      });
      console.debug("[ASR] READY", input);
    }),
    recStart: fromCallback(
      ({ sendBack, input }: { sendBack: any; input: any }) => {
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
                x[0].transcript.replace(/\.$/, ""),
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
      },
    ),
    nluPromise: fromPromise<any, AzureLanguageCredentials & { query: string }>(
      async ({ input }) => {
        const response = await fetch(
          new Request(input.endpoint, {
            method: "POST",
            headers: {
              "Ocp-Apim-Subscription-Key": input.key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              kind: "Conversation",
              analysisInput: {
                conversationItem: {
                  id: "PARTICIPANT_ID_HERE",
                  text: input.query,
                  modality: "text",
                  language: "en-US", // TODO
                  participantId: "PARTICIPANT_ID_HERE",
                },
              },
              parameters: {
                projectName: input.projectName,
                verbose: true,
                deploymentName: input.deploymentName,
                stringIndexType: "TextElement_V8",
              },
            }),
          }),
        );
        return response.json();
      },
    ),
  },
}).createMachine({
  id: "asr",
  context: ({ input }) => ({
    asrDefaultCompleteTimeout: input.asrDefaultCompleteTimeout || 0,
    asrDefaultNoInputTimeout: input.asrDefaultNoInputTimeout || 5000,
    locale: input.locale || "en-US",
    audioContext: input.audioContext,
    azureCredentials: input.azureCredentials,
    azureLanguageCredentials: input.azureLanguageCredentials,
    speechRecognitionEndpointId: input.speechRecognitionEndpointId,
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
      initial: "WaitForRecogniser",
      invoke: {
        id: "recStart",
        input: ({ context }) => ({
          wsaASR: context.wsaASR,
          wsaGrammarList: context.wsaGrammarList,
          locale: context.locale,
          phrases: (context.params || {}).hints || [],
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
        RECOGNISED: [
          {
            target: ".NLURequest",
            guard: ({ context }) =>
              !!(context.params.nlu && context.azureLanguageCredentials),
          },
          {
            target: "Ready",
            actions: [
              sendParent(({ context }) => ({
                type: "RECOGNISED",
                value: context.result,
              })),
            ],
          },
        ],
        CONTROL: {
          target: "Pause",
        },
        NOINPUT: {
          actions: sendParent({ type: "ASR_NOINPUT" }),
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
              },
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
          entry: [
            ({ context }) =>
              console.debug(
                "RECOGNISED will be sent in (ms)",
                (context.params || {}).completeTimeout ||
                  context.asrDefaultCompleteTimeout,
              ),
            raise(
              { type: "RECOGNISED" },
              {
                delay: ({ context }) =>
                  (context.params || {}).completeTimeout ||
                  context.asrDefaultCompleteTimeout,
                id: "completeTimeout",
              },
            ),
          ],
        },
        NLURequest: {
          invoke: {
            src: "nluPromise",
            input: ({ context }) => {
              let c: AzureLanguageCredentials;
              typeof context.params.nlu === "boolean"
                ? (c = context.azureLanguageCredentials)
                : (c = context.params.nlu);
              return {
                endpoint: c.endpoint,
                key: c.key,
                projectName: c.projectName,
                deploymentName: c.deploymentName,
                query: context.result[0].utterance,
              };
            },
            onDone: [
              {
                actions: [
                  ({ event }) =>
                    console.error("[ASR] no NLU prediction", event.output),
                  sendParent(({ context }) => ({
                    type: "RECOGNISED",
                    value: context.result,
                  })),
                ],
                target: "#asr.Ready",
                guard: ({ event }) => !(event.output.result || {}).prediction,
              },
              {
                actions: [
                  ({ event }) =>
                    console.debug(
                      "[ASR] NLU result",
                      event.output.result.prediction,
                    ),
                  sendParent(({ context, event }) => ({
                    type: "RECOGNISED",
                    value: context.result,
                    nluValue: event.output.result.prediction,
                  })),
                ],
                target: "#asr.Ready",
              },
            ],
            onError: {
              actions: [
                ({ event }) => console.error("[ASR]", event.error),
                sendParent(({ context }) => ({
                  type: "RECOGNISED",
                  value: context.result,
                })),
              ],
              target: "#asr.Ready",
            },
          },
        },
      },
    },
    Pause: {
      entry: sendParent({ type: "ASR_PAUSED" }),
      on: {
        CONTROL: {
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
          actions: ({ event }) => console.error("[ASR]", event.error),
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
          locale: context.locale,
          speechRecognitionEndpointId: context.speechRecognitionEndpointId,
        }),
      },
    },
  },
});
