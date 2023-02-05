import { createMachine, assign, spawn } from "xstate";
import { inspect } from "@xstate/inspect";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";
import { dmMachine } from "./dmColourChanger";

const TOKEN_ENDPOINT =
  "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken";

if (process.env.NODE_ENV === "development") {
  inspect({
    iframe: false,
  });
}

export const machine = createMachine(
  {
    predictableActionArguments: true,
    schema: {
      context: {} as DomainContext,
      events: {} as SDSEvent,
    },
    id: "sds",
    type: "parallel",
    states: {
      dm: {
        ...dmMachine,
      },
      asrtts: {
        initial: "initialize",
        on: {
          TTS_READY: {
            target: ".ready",
          },
          ASR_READY: {
            target: ".ready",
          },
          TTS_ERROR: ".fail",
          ASR_NOINPUT_TIMEOUT: ".ready",
        },
        states: {
          initialize: {
            initial: "await",
            states: {
              fail: {},
              await: {
                on: {
                  PREPARE: [
                    {
                      target: "getToken",
                      actions: "createAudioContext",
                    },
                  ],
                },
              },
              getToken: {
                invoke: {
                  id: "getAuthorizationToken",
                  src: (c, _evt) =>
                    getAuthorizationToken(c.parameters.azureKey!),
                  onDone: {
                    actions: "assignToken",
                    target: "ponyfill",
                  },
                  onError: {
                    target: "fail",
                  },
                },
              },
              ponyfill: {
                entry: [
                  assign<SDSContext, SDSEvent>({
                    ttsRef: (c: SDSContext) => {
                      return spawn(
                        ttsMachine.withContext({
                          ttsVoice: c.parameters.ttsVoice,
                          audioCtx: c.audioCtx,
                          azureAuthorizationToken: c.azureAuthorizationToken,
                          ttsLexicon: c.parameters.ttsLexicon,
                        })
                      );
                    },
                  }),
                  assign<SDSContext, SDSEvent>({
                    asrRef: (c: SDSContext) => {
                      return spawn(
                        asrMachine.withContext({
                          language: c.parameters.ttsVoice,
                          audioCtx: c.audioCtx,
                          azureAuthorizationToken: c.azureAuthorizationToken,
                        })
                      );
                    },
                  }),
                ],
                on: {
                  TTS_READY: {
                    target: "preReady",
                  },
                  ASR_READY: {
                    target: "preReady",
                  },
                },
              },
              preReady: {},
            },
          },
          ready: {
            initial: "idle",
            states: {
              idle: {
                on: {
                  LISTEN: [{ target: "waitForRecogniser" }],
                  SPEAK: [
                    {
                      target: "speaking",
                    },
                  ],
                },
              },
              speaking: {
                entry: (c, e: any) =>
                  c.ttsRef.send({
                    type: "START",
                    value: e.value,
                  }),
                on: { ENDSPEECH: "idle" },
              },
              waitForRecogniser: {
                entry: (c, _e: any) =>
                  c.asrRef.send({
                    type: "START",
                    value: { noinputTimeout: 5000, completeTimeout: 0 },
                  }),
                on: {
                  ASR_STARTED: "recognising",
                },
              },
              recognising: {
                on: {
                  RECOGNISED: {
                    target: "idle",
                    actions: "logRecResult",
                  },
                },
              },
            },
          },
          fail: {},
        },
      },
    },
  },
  {
    actions: {
      createAudioContext: (context: SDSContext) => {
        context.audioCtx = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            context.audioCtx.createMediaStreamSource(stream);
          });
      },
      assignToken: assign({
        azureAuthorizationToken: (_context, event: any) => event.data,
      }),
      assignRecResult: assign({
        recResult: (_context, event: any) => event.value,
      }),
      logRecResult: (_c, e: any) => {
        console.log("U>", e.value[0]["utterance"], {
          confidence: e.value[0]["confidence"],
        });
      },
      changeColour: (c) => {
        const event = new CustomEvent<any>("repaint", {
          detail: c.colour,
        });
        window.dispatchEvent(event);
        console.log(`(repaiting to ${c.colour})`);
      },
    },
  }
);

const getAuthorizationToken = (azureKey: string) =>
  fetch(
    new Request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
      },
    })
  ).then((data) => data.text());
