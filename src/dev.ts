import { createActor, createMachine, assign } from "xstate";

import { speechstate } from "./speechstate";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "./types";
import { createSkyInspector } from "@statelyai/inspect";

const { inspect } = createSkyInspector();

const azureSpeechCredentials: AzureSpeechCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "",
};

const azureLanguageCredentials: AzureLanguageCredentials = {
  endpoint:
    "https://speechstate.cognitiveservices.azure.com/language/:analyze-conversations?api-version=2022-10-01-preview",
  key: "",
  deploymentName: "Appointment1",
  projectName: "appointment",
};

const settings: Settings = {
  azureCredentials: azureSpeechCredentials,
  azureRegion: "swedencentral",
  azureLanguageCredentials: azureLanguageCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  // speechRecognitionEndpointId: "",
};

const speechMachine = createMachine({
  entry: assign({
    ssRef: ({ spawn }) => spawn(speechstate, { input: settings }),
  }),
});

export const speechState = createActor(speechMachine, { inspect });

speechState.start();
speechState.getSnapshot().context.ssRef.send({ type: "PREPARE" });


(window as any).speechService = speechState;
