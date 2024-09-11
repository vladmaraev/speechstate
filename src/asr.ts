import {
  setup,
  sendParent,
  assign,
  fromCallback,
  fromPromise,
  raise,
  cancel,
  sendTo,
} from "xstate";

import {
  ASRContext,
  ASREvent,
  ASRInit,
  ASRPonyfillInput,
  Hypothesis,
  AzureLanguageCredentials,
} from "./types";

import { getToken } from "./getToken";

import createSpeechRecognitionPonyfill from "@davi-ai/web-speech-cognitive-services-davi";

export const asrMachine = setup({
  types: {
    context: {} as ASRContext,
    events: {} as ASREvent,
    input: {} as ASRInit,
  },
  actions: {
    raise_noinput_after_timeout: raise(
      { type: "NOINPUT" },
      {
        delay: ({ context }) =>
          (context.params || {}).noInputTimeout ||
          context.asrDefaultNoInputTimeout,
        id: "timeout",
      },
    ),
    raise_recognised_after_completetimeout: raise(
      { type: "RECOGNISED" },
      {
        delay: ({ context }) =>
          (context.params || {}).completeTimeout ||
          context.asrDefaultCompleteTimeout,
        id: "completeTimeout",
      },
    ),
    cancel_noinput_timeout: cancel("timeout"),
    debug_completetimeout: ({ context }) =>
      console.debug(
        "RECOGNISED will be sent in (ms)",
        (context.params || {}).completeTimeout ||
          context.asrDefaultCompleteTimeout,
      ),
  },
  guards: {
    nlu_is_activated: ({ context }) =>
      !!((context.params || {}).nlu && context.azureLanguageCredentials),
  },
  actors: {
    getToken: getToken,
    new_ponyfill: fromCallback<null, ASRPonyfillInput>(
      ({ sendBack, input, receive }) => {
        const { SpeechGrammarList, speechRecognition } =
          createSpeechRecognitionPonyfill(
            {
              audioContext: input.audioContext,
              // speechRecognitionEndpointId: input.speechRecognitionEndpointId, // ? need to check, probably it is supported but types are problematic
              credentials: {
                region: input.azureRegion,
                authorizationToken: input.azureAuthorizationToken,
              },
            },
            { passive: false, lang: input.locale || "en-US" },
          );
        let asr: SpeechRecognition = speechRecognition;
        asr.onresult = function (event: any) {
          if (event[event.length - 1].isFinal) {
            const transcript = event
              .map((x) => x.transcript.replace(/\.$/, ""))
              .join(" ");
            const confidence =
              event
                .map((x) => x.confidence)
                .reduce((a: number, b: number) => a + b) / event.length;
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
        asr.onstart = function () {
          sendBack({ type: "STARTED" });
        };
        asr.onend = function () {
          sendBack({ type: "LISTEN_COMPLETE" });
        };
        // any: it works, but gives unexpected type error
        (asr as any).onabort = function () {
          sendBack({ type: "LISTEN_COMPLETE" });
        };
        console.debug("[ASR] NEW_READY", asr);
        sendBack({ type: "NEW_READY", value: asr });
        receive((event: { type: "START" | "STOP" }) => {
          if (event.type === "START") {
            console.log("[asr.callback] Receiving START");
            asr.start();
          }
          if (event.type === "STOP") {
            console.log("[asr.callback] Receiving STOP");
            asr.abort();
          }
        });
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
    azureRegion: input.azureRegion,
    azureLanguageCredentials: input.azureLanguageCredentials,
    speechRecognitionEndpointId: input.speechRecognitionEndpointId,
  }),
  initial: "GetToken",
  states: {
    Fail: {},
    GetToken: {
      invoke: {
        id: "getAuthorizationToken",
        input: ({ context }) => ({
          credentials: context.azureCredentials,
        }),
        src: "getToken",
        onDone: {
          target: "NewPonyfill",
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
    NewPonyfill: {
      initial: "NotPonyfilled",
      invoke: {
        id: "asr",
        src: "new_ponyfill",
        input: ({ context }) => ({
          azureRegion: context.azureRegion,
          audioContext: context.audioContext,
          azureAuthorizationToken: context.azureAuthorizationToken,
          locale: context.locale,
          speechRecognitionEndpointId: context.speechRecognitionEndpointId,
        }),
      },
      states: {
        NotPonyfilled: {
          on: { NEW_READY: "Ready" },
        },
        Ready: {
          entry: sendParent({ type: "ASR_READY" }),
          on: {
            START: {
              target: "Recognising",
              actions: assign(({ event }) => {
                params: event.value;
              }),
            },
            START: {
              target: "Recognising",
              actions: assign(({ event }) => {
                params: event.value;
              }),
            },
          },
        },
        Recognising: {
          entry: sendTo("asr", { type: "START" }),
          initial: "WaitForRecogniser",
          on: {
            STOP: {
              target: ".WaitToStop",
            },
            CONTROL: {
              target: "Pausing",
            },
            NOINPUT: {
              actions: sendParent({ type: "ASR_NOINPUT" }),
              target: ".WaitToStop",
            },
          },
          onDone: "Ready",
          states: {
            WaitForRecogniser: {
              on: {
                STARTED: {
                  target: "NoInput",
                  actions: [
                    () => console.debug("[ASR] STARTED"),
                    sendParent({ type: "ASR_STARTED" }),
                  ],
                },
              },
            },
            NoInput: {
              entry: { type: "raise_noinput_after_timeout" },
              on: {
                STARTSPEECH: {
                  target: "InProgress",
                  actions: cancel("completeTimeout"),
                },
              },
              exit: { type: "cancel_noinput_timeout" },
            },
            InProgress: {
              entry: () => console.debug("[ASR] in progress"),
              on: {
                RESULT: {
                  actions: [
                    assign({
                      result: ({ event }) => event.value,
                    }),
                    cancel("completeTimeout"),
                  ],
                  target: "ReceivedResult",
                },
              },
            },
            ReceivedResult: {
              on: {
                RESULT: {
                  actions: [
                    assign({
                      result: ({ event }) => event.value,
                    }),
                    cancel("completeTimeout"),
                  ],
                },
                RECOGNISED: [
                  {
                    target: "#asr.NewPonyfill.NLURequest",
                    guard: { type: "nlu_is_activated" },
                  },
                  {
                    target: "WaitToStop",
                    actions: sendParent(({ context }) => ({
                      type: "RECOGNISED",
                      value: context.result,
                    })),
                  },
                ],
              },
              entry: [
                { type: "debug_completetimeout" },
                { type: "raise_recognised_after_completetimeout" },
              ],
            },
            WaitToStop: {
              entry: sendTo("asr", { type: "STOP" }),
              on: {
                LISTEN_COMPLETE: {
                  actions: [sendParent({ type: "LISTEN_COMPLETE" })],
                  target: "Stopped",
                },
              },
            },
            Stopped: { type: "final" },
          },
        },
        Pausing: {
          initial: "WaitToPause",
          onDone: "Recognising",
          states: {
            WaitToPause: {
              on: {
                LISTEN_COMPLETE: {
                  target: "Paused",
                },
              },
              entry: sendTo("asr", { type: "STOP" }),
            },
            Paused: {
              entry: sendParent({ type: "ASR_PAUSED" }),
              on: {
                CONTROL: {
                  target: "Continue",
                  //       ///// todo? reset noInputTimeout
                },
              },
            },
            Continue: { type: "final" },
          },
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
                  sendParent({ type: "LISTEN_COMPLETE" }),
                ],
                target: "Ready",
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
                  sendParent({ type: "LISTEN_COMPLETE" }),
                ],
                target: "Ready",
              },
            ],
            onError: {
              actions: [
                ({ event }) => console.error("[ASR]", event.error),
                sendParent(({ context }) => ({
                  type: "RECOGNISED",
                  value: context.result,
                })),
                sendParent({ type: "LISTEN_COMPLETE" }),
              ],
              target: "Ready",
            },
          },
        },
      },
    },
  },
});
