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

import createSpeechRecognitionPonyfill, {
  SpeechRecognitionResultListItem,
} from "@vladmaraev/web-speech-cognitive-services-davi";

export const asrMachine = setup({
  types: {
    context: {} as ASRContext,
    events: {} as ASREvent,
    input: {} as ASRInit,
  },
  delays: {
    noinputTimeout: ({ context }) =>
      (context.params || {}).noInputTimeout || context.asrDefaultNoInputTimeout,
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
      const nlu = (context.params || {}).nlu;
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
    new_ponyfill: fromCallback<null, ASRPonyfillInput>(
      ({ sendBack, input, receive }) => {
        const { speechRecognition } = createSpeechRecognitionPonyfill(
          {
            audioContext: input.audioContext,
            speechRecognitionEndpointId: input.speechRecognitionEndpointId,
            credentials: {
              region: input.azureRegion,
              authorizationToken: input.azureAuthorizationToken,
            },
          },
          {
            passive: false,
            interimResults: true,
            continuous: true,
            lang: input.locale || "en-US",
            grammarsList: input.hints,
            autoStart: true,
            timerBeforeSpeechEnd: input.completeTimeout,
            // debug: true,
          },
        );
        let asr: SpeechRecognition = speechRecognition;
        asr.onresult = function (event: any) {
          if (event.isFinal) {
            const transcript = event
              .map((x: SpeechRecognitionResultListItem) =>
                x.transcript.replace(/\.$/, ""),
              )
              .join(" ");
            const confidence =
              event
                .map((x: SpeechRecognitionResultListItem) => x.confidence)
                .reduce((a: number, b: number) => a + b) / event.length;
            const res: Hypothesis[] = [
              {
                utterance: transcript,
                confidence: confidence,
              },
            ];
            sendBack({
              type: "RECOGNISED",
              value: res,
            });
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
        console.debug("[ASR] READY", asr);
        sendBack({ type: "READY", value: asr });
        receive((event: { type: "STOP" }) => {
          if (event.type === "STOP") {
            console.log("[asr.callback] Receiving STOP");
            asr.abort();
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
          actions: assign(({ event }) => ({
            params: event.value,
          })),
        },
      },
    },
    Recognising: {
      onDone: "Ready",
      invoke: {
        id: "asr",
        src: "new_ponyfill",
        input: ({ context }) => ({
          azureRegion: context.azureRegion,
          audioContext: context.audioContext,
          azureAuthorizationToken: context.azureAuthorizationToken,
          locale: (context.params || {}).locale || context.locale,
          speechRecognitionEndpointId: context.speechRecognitionEndpointId,
          completeTimeout:
            (context.params || {}).completeTimeout ||
            context.asrDefaultCompleteTimeout,
          hints: (context.params || {}).hints,
        }),
      },
      on: {
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
            RECOGNISED: [
              {
                target: "NLURequest",
                guard: { type: "nlu_is_activated" },
                actions: assign({
                  result: ({ event }) => event.value,
                }),
              },
              {
                target: "WaitToStop",
                actions: [
                  assign({
                    result: ({ event }) => event.value,
                  }),
                  sendParent(({ context }) => ({
                    type: "RECOGNISED",
                    value: context.result,
                  })),
                ],
              },
            ],
          },
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
                ? (c = context.azureLanguageCredentials)
                : (c = context.params.nlu);
              return {
                endpoint: c.endpoint,
                key: c.key,
                projectName: c.projectName,
                deploymentName: c.deploymentName,
                query: context.result[0].utterance,
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
