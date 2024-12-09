import { createActor, waitFor, setup } from "xstate";
import { ttsMachine } from "./tts";
import { AZURE_KEY } from "./credentials";

const azureSpeechCredentials = {
  endpoint:
    "https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: AZURE_KEY,
};

const ttsManager = setup({}).createMachine({
  context: ({ spawn }) => {
    return {
      ttsRef: spawn(ttsMachine, {
        input: {
          audioContext: new AudioContext(),
          azureCredentials: azureSpeechCredentials,
          azureRegion: "swedencentral",
          locale: "en-US",
          ttsDefaultVoice: "en-US-EmmaMultilingualNeural",
        },
      }),
    };
  },
});

const actor = createActor(ttsManager);
actor.start();

const readyTTS = await waitFor(
  actor.getSnapshot().context.ttsRef,
  (snapshot) => {
    return snapshot.matches("Ready");
  },
);

console.log("READY!!!", readyTTS);
actor.getSnapshot().context.ttsRef.send({
  type: "SPEAK",
  value: {
    utterance: "Hello, I speak with a default voice.",
    audioURL:
      "https://mdn.github.io/webaudio-examples/decode-audio-data/promise/viper.mp3",
  },
});

(window as any).ttsService = actor;
