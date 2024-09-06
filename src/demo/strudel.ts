import { initStrudel, note, rev, samples, evaluate } from "@strudel/web";
import { createBrowserInspector } from "@statelyai/inspect";

const inspector = createBrowserInspector();

// const { note } = controls;

import { AnyActorRef, createActor, setup, assign, fromPromise } from "xstate";

import { speechstate } from "../speechstate";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "../types";

const azureSpeechCredentials: AzureSpeechCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "2e15e033f605414bbbfe26cb631ab755",
};

const settings: Settings = {
  azureCredentials: azureSpeechCredentials,
  azureRegion: "northeurope",
  // azureLanguageCredentials: azureLanguageCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  // speechRecognitionEndpointId: "",
};

const speechMachine = setup({
  types: {} as {
    context: {
      ctx?: AudioContext;
      ssRef: AnyActorRef;
      scheduler?: any;
    };
  },
  actions: {
    prepare_speechstate: ({ context }) =>
      context.ssRef.send({ type: "PREPARE" }),
    play_note1: () => note("<c a f e>(3,8)").jux(rev).play(),
    play_note2: () => note("<b b ab e>(3,8)").jux(rev).play(),
    listen: ({ context }) =>
      context.ssRef.send({
        type: "LISTEN",
      }),
    play: (_, params: { value: string }) => {
      const regex = /[a-g]/g;
      const notes = params.value.toLowerCase().match(regex);
      console.log(notes);
      if (notes) {
        evaluate(`note("<${notes.slice(0, 8).join(" ")}>(3,8)").jux(rev)`);
      }
    },
  },
}).createMachine({
  context: ({ spawn }) => {
    return {
      ssRef: spawn(speechstate, { input: settings }),
    };
  },
  initial: "Idle",
  states: {
    Idle: { on: { CLICK: "Prepare" } },
    Prepare: {
      entry: { type: "prepare_speechstate" },
      on: { ASRTTS_READY: "Main" },
    },
    // PrepareStrudel: {
    //   entry: initStrudel(),
    // },
    Main: {
      initial: "Listen",
      entry: [
        initStrudel({
          prebake: () => samples("github:tidalcycles/dirt-samples"),
        }),
      ],
      states: {
        Wait: {
          on: { ASR_STOPPED: "Listen" },
        },
        Listen: {
          entry: { type: "listen" },
          on: {
            RECOGNISED: {
              target: "Wait",
              // actions: {
              //   type: "play",
              //   params: ({ event }) => ({
              //     value: event.value[0].utterance,
              //   }),
              // },
            },
            ASR_NOINPUT: { target: "Wait", reenter: true },
          },
        },
        Modify: {},
      },
    },
  },
});

export const speechState = createActor(speechMachine, {
  inspect: inspector.inspect,
});

speechState.start();

(window as any).speechService = speechState;

document
  .getElementById("start")!
  .addEventListener("click", () => speechState.send({ type: "CLICK" }));
