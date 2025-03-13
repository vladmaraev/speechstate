import { createActor, createMachine } from "xstate";

import { speechstate } from "./speechstate";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "./types";
// import { createBrowserInspector } from "@statelyai/inspect";
import { AZURE_KEY } from "./credentials";

// const inspector = createBrowserInspector();

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
  // azureLanguageCredentials: azureLanguageCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  // speechRecognitionEndpointId: "",
};

const speechMachine = createMachine({
  context: ({ spawn }) => {
    return { ssRef: spawn(speechstate, { input: settings }) };
  },
  initial: "Main",
  states: {
    Main: {
      on: { CLICK: "ShareAudio" },
    },
    ShareAudio: { on: { CLICK: "UtteranceOne" } },
    UtteranceOne: {
      entry: ({ context }) =>
        context.ssRef.send({
          type: "SPEAK",
          value: {
            utterance: `<mstts:viseme type="FacialExpression"/> Hello <bookmark mark='flower_1'/>there`,
            voice: "en-US-AvaNeural",
            visemes: true,
          },
        }),
      on: { SPEAK_COMPLETE: "Listening" },
    },
    Listening: {
      entry: ({ context }) =>
        context.ssRef.send({
          type: "LISTEN",
        }),
      on: { LISTEN_COMPLETE: "UtteranceTwo" },
    },
    UtteranceTwo: {
      entry: ({ context }) =>
        context.ssRef.send({
          type: "SPEAK",
          value: {
            utterance: "And hello",
          },
        }),
    },
  },
});

export const speechState = createActor(speechMachine, {
  // inspect: inspector.inspect,
});

speechState.start();
speechState.getSnapshot().context.ssRef.send({ type: "PREPARE" });

(window as any).speechService = speechState;

/* recording implementation
 */

let stream = undefined;
const recordedChunks = [];
const recordedMicChunks = [];
const options = { mimeType: "video/webm; codecs=vp9" };

document
  .getElementById("app")!
  .addEventListener("click", async function (event) {
    speechState.send({ type: "CLICK" });
    if (!stream) {
      stream = await startCapture(displayMediaOptions);
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorder.ondataavailable = handleDataAvailable;
      const micStream = await startMicCapture();
      const micRecorder = new MediaRecorder(micStream, options);
      micRecorder.ondataavailable = handleMicDataAvailable;

      mediaRecorder.start();
      // demo: to download after 9sec
      setTimeout((event) => {
        console.log("stopping");
        mediaRecorder.stop();
      }, 9000);

      micRecorder.start();
      // demo: to download after 9sec
      setTimeout((event) => {
        console.log("stopping");
        micRecorder.stop();
      }, 9000);
    }
  });

const displayMediaOptions = {
  video: {
    displaySurface: "browser",
  },
  audio: true,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  systemAudio: "include",
  surfaceSwitching: "include",
  monitorTypeSurfaces: "include",
};

async function startMicCapture() {
  let captureStream;

  try {
    captureStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  return captureStream;
}

async function startCapture(displayMediaOptions) {
  let captureStream;

  try {
    captureStream =
      await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  return captureStream;
}

function handleDataAvailable(event) {
  console.log("data-available");
  if (event.data.size > 0) {
    recordedChunks.push(event.data);
    console.log(recordedChunks);
    download(recordedChunks, "screen");
  } else {
    // …
  }
}

function handleMicDataAvailable(event) {
  console.log("data-available");
  if (event.data.size > 0) {
    recordedMicChunks.push(event.data);
    console.log(recordedMicChunks);
    download(recordedMicChunks, "mic");
  } else {
    // …
  }
}

function download(chunks, name) {
  const blob = new Blob(chunks, {
    type: "video/webm",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  document.body.appendChild(a);
  a.style = "display: none";
  a.href = url;
  a.download = `${name}.webm`;
  a.click();
  window.URL.revokeObjectURL(url);
}
