import {
  setup,
  sendParent,
  assign,
  fromCallback,
  fromPromise,
  raise,
  cancel,
  sendTo,
  EventObject,
} from "xstate";

import {
  ASRContext,
  ASREvent,
  ASRInit,
  ASRPonyfillInput,
  Hypothesis,
  AzureLanguageCredentials,
} from "./types";

import { createSpeechRecognitionPonyfill } from "web-speech-cognitive-services";

export const asrMachine = setup({
  types: {
    context: {} as ASRContext,
    events: {} as ASREvent,
    input: {} as ASRInit,
  },
  delays: {
    noinputTimeout: ({ context }) =>
      context.params.noInputTimeout ?? context.asrDefaultNoInputTimeout,
  },
  actions: {
    raise_noinput_after_timeout: raise(
      { type: "NOINPUT" },
      {
        delay: "noinputTimeout",
        id: "timeout",
      },
    ),
    cancel_noinput_timeout: cancel("timeout"),
  },
  guards: {
    nlu_is_activated: ({ context }) => {
      const nlu = context.params.nlu;
      if (nlu) {
        if (typeof nlu === "object") {
          return true;
        } else if (context.azureLanguageCredentials) {
          return true;
        }
      }
      return false;
    },
  },
  actors: {
    maybe_ponyfill: fromCallback<null, ASRPonyfillInput>(
      ({ sendBack, input, receive }) => {
        let recognition: SpeechRecognition;
        if (input.azureAuthorizationToken) {
          const { SpeechGrammarList, SpeechRecognition } =
            createSpeechRecognitionPonyfill({
              speechRecognitionEndpointId: input.speechRecognitionEndpointId,
              credentials: {
                region: input.azureRegion,
                authorizationToken: input.azureAuthorizationToken,
              },
            });
          recognition = new SpeechRecognition() as any; // ponyfill type mismatch?
          recognition.grammars = new SpeechGrammarList();
          if (input.hints) {
            (recognition.grammars as any).phrases = input.hints;
          }
        } else {
          const SpeechRecognition: {
            prototype: SpeechRecognition;
            new (): SpeechRecognition;
          } = window.webkitSpeechRecognition;
          recognition = new SpeechRecognition();
          if (input.hints && window.webkitSpeechGrammarList) {
            let speechRecognitionList = new window.webkitSpeechGrammarList();
            const grammar =
              "#JSGF V1.0; grammar hints; public <hints> = " +
              input.hints.join(" | ") +
              " ;";
            speechRecognitionList.addFromString(grammar, 1);
            recognition.grammars = speechRecognitionList;
          }
        }
        recognition.continuous = true;
        recognition.lang = input.locale || "en-US";
        recognition.interimResults = true;
        recognition.start();
        recognition.onresult = function (event) {
          if (event.results[event.results.length - 1].isFinal) {
            const transcript = Array.from(event.results)
              .map((x: SpeechRecognitionResult) =>
                x[0].transcript.replace(/\.$/, ""),
              )
              .join(" ");
            const confidence =
              Array.from(event.results)
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
        recognition.onstart = function () {
          sendBack({ type: "STARTED" });
        };
        recognition.onend = function () {
          sendBack({ type: "LISTEN_COMPLETE" });
        };
        // any: it works, but gives unexpected type error
        (recognition as any).onabort = function () {
          sendBack({ type: "LISTEN_COMPLETE" });
        };
        console.debug("[ASR] READY", recognition);
        sendBack({ type: "READY", value: recognition });
        receive((event: { type: "STOP" }) => {
          if (event.type === "STOP") {
            console.debug("[asr.callback] Receiving STOP");
            recognition.abort();
          }
        });
      },
    ),
    nluPromise: fromPromise<
      any,
      AzureLanguageCredentials & { query: string; locale: string }
    >(async ({ input }) => {
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
                language: input.locale,
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
    }),
  },
}).createMachine({
  id: "asr",
  context: ({ input }) => ({
    azureAuthorizationToken: input.azureAuthorizationToken,
    asrDefaultCompleteTimeout: input.asrDefaultCompleteTimeout || 0,
    asrDefaultNoInputTimeout: input.asrDefaultNoInputTimeout || 5000,
    locale: input.locale || "en-US",
    audioContext: input.audioContext,
    azureRegion: input.azureRegion,
    azureLanguageCredentials: input.azureLanguageCredentials,
    speechRecognitionEndpointId: input.speechRecognitionEndpointId,
    params: {},
  }),
  initial: "Ready",
  on: {
    NEW_TOKEN: {
      actions: assign(({ event }) => {
        return { azureAuthorizationToken: event.value };
      }),
    },
  },
  states: {
    Fail: {},
    Ready: {
      entry: sendParent({ type: "ASR_READY" }),
      on: {
        START: {
          target: "Recognising",
          actions: assign(({ context, event }) => ({
            params: { ...context.params, ...event.value },
          })),
        },
        UPDATE_ASR_PARAMS: {
          actions: [
            ({ event }) =>
              console.debug("[ASR] UPDATE_ASR_PARAMS", event.value),
            assign(({ event }) => ({
              params: event.value,
            })),
          ],
        },
      },
    },
    Recognising: {
      onDone: "Ready",
      invoke: {
        id: "asr",
        src: "maybe_ponyfill",
        input: ({ context }) => ({
          azureRegion: context.azureRegion,
          audioContext: context.audioContext,
          azureAuthorizationToken: context.azureAuthorizationToken,
          locale: context.params.locale || context.locale,
          speechRecognitionEndpointId: context.speechRecognitionEndpointId,
          completeTimeout:
            context.params.completeTimeout || context.asrDefaultCompleteTimeout,
          hints: context.params.hints,
        }),
      },
      on: {
        FINAL_RESULT: [
          {
            target: ".NLURequest",
            guard: { type: "nlu_is_activated" },
          },
          {
            target: ".WaitToStop",
            actions: sendParent(({ context }) => ({
              type: "RECOGNISED",
              value: context.result,
            })),
          },
        ],
        RESULT: {
          actions: [
            assign({
              result: ({ event }) => event.value,
            }),
            cancel("completeTimeout"),
          ],
          target: ".InterimResult",
        },
        STOP: {
          target: ".WaitToStop",
        },
        CONTROL: {
          target: ".Pausing",
        },
        NOINPUT: {
          actions: sendParent({ type: "ASR_NOINPUT" }),
          target: ".WaitToStop",
        },
      },
      initial: "WaitForRecogniser",
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
          initial: "Wait",
          on: {
            STARTSPEECH: {
              target: "InProgress",
              actions: [
                sendParent({ type: "STARTSPEECH" }),
                cancel("completeTimeout"),
              ],
            },
          },
          states: {
            Wait: {
              on: { START_NOINPUT_TIMEOUT: "ApplyNoInputTimeout" },
            },
            ApplyNoInputTimeout: {
              entry: [
                ({ context }) =>
                  console.debug(
                    "[ASR] START_NOINPUT_TIMEOUT",
                    context.params.noInputTimeout ??
                      context.asrDefaultNoInputTimeout,
                  ),
                { type: "raise_noinput_after_timeout" },
              ],
            },
          },
          exit: { type: "cancel_noinput_timeout" },
        },
        InProgress: {
          entry: () => console.debug("[ASR] in progress"),
        },
        InterimResult: {
          entry: [
            ({ context }) =>
              console.debug(
                "RECOGNISED will be sent in (ms)",
                (context.params || {}).completeTimeout ||
                  context.asrDefaultCompleteTimeout,
              ),
            raise(
              { type: "FINAL_RESULT" },
              {
                delay: ({ context }) =>
                  (context.params || {}).completeTimeout ||
                  context.asrDefaultCompleteTimeout,
                id: "completeTimeout",
              },
            ),
          ],
        },
        WaitToStop: {
          entry: sendTo("asr", { type: "STOP" }),
          on: {
            LISTEN_COMPLETE: {
              actions: sendParent({ type: "LISTEN_COMPLETE" }),
              target: "Stopped",
            },
          },
        },
        Pausing: {
          onDone: "#asr.Recognising",
          initial: "WaitToPause",
          states: {
            WaitToPause: {
              entry: sendTo("asr", { type: "STOP" }),
              on: {
                LISTEN_COMPLETE: {
                  target: "Paused",
                },
              },
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
                ? (c = context.azureLanguageCredentials!)
                : (c = context.params.nlu as AzureLanguageCredentials);
              return {
                endpoint: c.endpoint,
                key: c.key,
                projectName: c.projectName,
                deploymentName: c.deploymentName,
                query: context.result![0].utterance,
                locale: (context.params || {}).locale || context.locale,
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
                target: "WaitToStop",
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
                target: "WaitToStop",
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
              target: "WaitToStop",
            },
          },
        },
        Stopped: { type: "final" },
      },
    },
  },
});
