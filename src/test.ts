import { interpret } from "xstate";
import { machine } from "./speechstate";
import { inspect } from "@xstate/inspect";

const cr = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "2e15e033f605414bbbfe26cb631ab755",
};

const settings: Settings = {
  azureCredentials: "https://tala.pratb.art/gettoken.php",
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
