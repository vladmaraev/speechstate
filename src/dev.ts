import { createActor, createMachine } from "xstate";

import { speechstate } from "./speechstate";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "./types";
import { createBrowserInspector } from "@statelyai/inspect";
import { AZURE_KEY } from "./credentials";

const inspector = createBrowserInspector();

const azureSpeechCredentials: AzureSpeechCredentials = {
  endpoint:
    "https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: AZURE_KEY,
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
  locale: "sv-SE",
  ttsDefaultVoice: "en-US-DavisNeural",
  // speechRecognitionEndpointId: "",
};

const speechMachine = createMachine({
  context: ({ spawn }) => {
    return { ssRef: spawn(speechstate, { input: settings }) };
  },
  initial: "Main",
  states: { Main: {} },
});

export const speechState = createActor(speechMachine, {
  inspect: inspector.inspect,
});

speechState.start();
speechState.getSnapshot().context.ssRef.send({ type: "PREPARE" });

(window as any).speechService = speechState;
