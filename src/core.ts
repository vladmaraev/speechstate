import { interpret } from "xstate";
import { speechstate } from "./speechstate";

const cr: AzureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "",
};

const settings: Settings = {
  azureCredentials: "",
  asrDefaultCompleteTimeout: 0,
  locale: "en-US",
};

const talaSpeechService = interpret(speechstate, {
  input: {
    settings: settings,
  },
});

talaSpeechService.subscribe((state) => {
  console.debug(state.value);
  // console.debug(state.context.ttsRef);
  // console.debug(state.context.asrRef);
});

talaSpeechService.start();

talaSpeechService.send({ type: "PREPARE" });

(window as any).talaSpeechService = talaSpeechService;
