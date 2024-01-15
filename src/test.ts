import { createActor, createMachine, assign } from "xstate";
import { speechstate } from "./speechstate";
import { AzureCredentials, Settings } from "./types";

const azureCredentials: AzureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "",
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const speechMachine = createMachine({
  entry: assign({
    ssRef: ({ spawn }) => spawn(speechstate, { input: settings, id: "ss" }),
  }),
});

const speechService = createActor(speechMachine);

speechService.start();
speechService.getSnapshot().context.ssRef.send({ type: "PREPARE" });

(window as any).speechService = speechService;
