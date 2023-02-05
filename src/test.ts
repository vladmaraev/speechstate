import { interpret } from "xstate";
import { machine } from "./speechstate";
import { inspect } from "@xstate/inspect";

const cr = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "<MASK>",
};

const settings: Settings = {
  azureCredentials: cr, // or  "<MASK>"
  asrDefaultCompleteTimeout: 0,
  locale: "en-US",
};

const talaSpeechService = interpret(machine, {
  input: {
    settings: settings,
  },
});

talaSpeechService.subscribe((state) => {
  // console.debug(state.value);
});

talaSpeechService.start();

talaSpeechService.send({ type: "PREPARE" });

(window as any).talaSpeechService = talaSpeechService;
