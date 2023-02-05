import { interpret } from "xstate";
import { machine } from "./speechstate";

const externalContext = {
  parameters: {
    ttsVoice: "en-US",
    ttsLexicon: null,
    asrLanguage: "en-US",
    azureKey: "",
  },
};

export const service = interpret(
  machine.withContext({ ...machine.context, ...externalContext }),
  {
    devTools: process.env.NODE_ENV === "development" ? true : false,
  }
); // .onTransition((state, event) => {
//    console.log(state, event);
// });

service.start();

window.addEventListener("spstPrepare", () => service.send("PREPARE"));
window.addEventListener("spstClick", () => service.send("CLICK"));
