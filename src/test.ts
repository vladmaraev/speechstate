import { createActor, createMachine, assign } from "xstate";
import { speechstate } from "./speechstate";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "./types";
import { createBrowserInspector } from "@statelyai/inspect";

const { inspect } = createBrowserInspector();

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

const speechService = createActor(speechMachine, { inspect });

speechService.start();
speechService.getSnapshot().context.ssRef.send({ type: "PREPARE" });

(window as any).speechService = speechService;
