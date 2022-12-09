import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createMachine, assign, actions, State } from "xstate";
import { useMachine } from "@xstate/react";
import { inspect } from "@xstate/inspect";
import { dmMachine } from "./dmMarkovGame";

import createSpeechRecognitionPonyfill from "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";
import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

const { send, cancel } = actions;

const TOKEN_ENDPOINT =
  "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken";
const REGION = "northeurope";

if (process.env.NODE_ENV === "development") {
  inspect({
    iframe: false,
  });
}

const defaultPassivity = 10;

const machine = createMachine(
  {
    predictableActionArguments: true,
    schema: {
      context: {} as SDSContext,
      events: {} as SDSEvent,
    },
    id: "root",
    type: "parallel",
    states: {
      dm: {
        ...dmMachine,
      },

      gui: {
        initial: "micOnly",
        states: {
          micOnly: {
            on: { SHOW_ALTERNATIVES: "showAlternatives" },
          },
          showAlternatives: {
            on: { SELECT: "micOnly" },
          },
        },
      },

      asrtts: {
        initial: "init",
        states: {
          init: {
            on: {
              CLICK: {
                target: "getToken",
                actions: [
                  "createAudioContext",
                  (context) =>
                    navigator.mediaDevices
                      .getUserMedia({ audio: true })
                      .then(function (stream) {
                        context.audioCtx.createMediaStreamSource(stream);
                      }),
                ],
              },
            },
          },
          getToken: {
            invoke: {
              id: "getAuthorizationToken",
              src: (context) =>
                getAuthorizationToken(context.parameters.azureKey!),
              onDone: {
                actions: ["assignToken", "ponyfillASR"],
                target: "ponyfillTTS",
              },
              onError: {
                target: "fail",
              },
            },
          },
          ponyfillTTS: {
            invoke: {
              id: "ponyTTS",
              src: (context, _event) => (callback, _onReceive) => {
                const ponyfill = createSpeechSynthesisPonyfill({
                  audioContext: context.audioCtx,
                  credentials: {
                    region: REGION,
                    authorizationToken: context.azureAuthorizationToken,
                  },
                });
                const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
                context.tts = speechSynthesis;
                context.ttsUtterance = SpeechSynthesisUtterance;
                context.tts.addEventListener("voiceschanged", () => {
                  context.tts.cancel();
                  const voices = context.tts.getVoices();
                  const voiceRe = RegExp(context.parameters.ttsVoice, "u");
                  const voice = voices.find((v: any) => voiceRe.test(v.name))!;
                  if (voice) {
                    context.voice = voice;
                    callback("TTS_READY");
                  } else {
                    console.error(
                      `TTS_ERROR: Could not get voice for regexp ${voiceRe}`
                    );
                    callback("TTS_ERROR");
                  }
                });
              },
            },
            on: {
              TTS_READY: "idle",
              TTS_ERROR: "fail",
            },
          },
          idle: {
            on: {
              LISTEN: "recognising",
              SPEAK: {
                target: "speaking",
                actions: "assignAgenda",
              },
            },
          },
          recognising: {
            initial: "noinput",
            exit: "recStop",
            on: {
              ASRRESULT: {
                actions: "assignRecResult",
                target: ".match",
              },
              RECOGNISED: { target: "idle", actions: "recLogResult" },
              SELECT: "idle",
              CLICK: ".pause",
            },
            states: {
              noinput: {
                entry: [
                  "recStart",
                  send(
                    { type: "TIMEOUT" },
                    {
                      delay: (_context: SDSContext) => 1000 * defaultPassivity,
                      id: "timeout",
                    }
                  ),
                ],
                on: {
                  TIMEOUT: "#root.asrtts.idle",
                  STARTSPEECH: "inprogress",
                },
                exit: cancel("timeout"),
              },
              inprogress: {},
              match: {
                entry: send("RECOGNISED"),
              },
              pause: {
                entry: "recStop",
                on: { CLICK: "noinput" },
              },
            },
          },
          speaking: {
            entry: "ttsStart",
            on: {
              ENDSPEECH: "idle",
              SELECT: "idle",
              CLICK: { target: "idle", actions: "sendEndspeech" },
            },
            exit: "ttsStop",
          },
          fail: {},
        },
      },
    },
  },
  {
    guards: {
      prob: (_context, _event, { cond }: any) => {
        let rnd = Math.random();
        return rnd >= cond.threshold ? true : false;
      },
    },
    actions: {
      createAudioContext: (context: SDSContext) => {
        context.audioCtx = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            context.audioCtx.createMediaStreamSource(stream);
          });
      },
      assignToken: assign({
        azureAuthorizationToken: (_context, event: any) => event.data,
      }),
      assignAgenda: assign({
        ttsAgenda: (_context, event: any) => event.value,
      }),
      assignRecResult: assign({
        recResult: (_context, event: any) => event.value,
      }),
      sendEndspeech: send("ENDSPEECH"),
      recLogResult: (context: SDSContext) => {
        console.log("U>", context.recResult[0]["utterance"], {
          confidence: context.recResult[0]["confidence"],
        });
      },
      logIntent: (context: SDSContext) => {
        /* context.nluData = event.data */
        console.log("<< NLU intent: " + context.nluData.intent.name);
      },
      changeColour: (context) => {
        let color = context.recResult[0].utterance
          .toLowerCase()
          .replace(/[\W_]+/g, "");
        console.log(`(repaiting to ${color})`);
        document.body.style.backgroundColor = color;
      },
    },
  }
);

interface Props extends React.HTMLAttributes<HTMLElement> {
  state: State<SDSContext, any, any, any, any>;
  alternative: any;
}
const ReactiveButton = (props: Props): JSX.Element => {
  var promptText = "\u00A0";
  var circleClass = "circle";
  switch (true) {
    case props.state.matches({ asrtts: "fail" }) ||
      props.state.matches({ dm: "fail" }):
      break;
    case props.state.matches({ asrtts: { recognising: "pause" } }):
      promptText = "Click to continue";
      break;
    case props.state.matches({ asrtts: "recognising" }):
      circleClass = "circle-recognising";
      promptText = "Listening...";
      break;
    case props.state.matches({ asrtts: "speaking" }):
      circleClass = "circle-speaking";
      promptText = "Speaking...";
      break;
    case props.state.matches({ dm: "idle" }):
      promptText = "Click to start!";
      circleClass = "circle-click";
      break;
    case props.state.matches({ dm: "init" }):
      promptText = "Click to start!";
      circleClass = "circle-click";
      break;
    default:
      promptText = "\u00A0";
  }
  return (
    <div className="control">
      <div className="status">
        <button
          type="button"
          className={circleClass}
          style={{}}
          {...props}
        ></button>
        <div className="status-text">{promptText}</div>
      </div>
    </div>
  );
};

function App({ domElement }: any) {
  const externalContext = {
    parameters: {
      ttsVoice: domElement.getAttribute("data-tts-voice") || "en-US",
      ttsLexicon: domElement.getAttribute("data-tts-lexicon"),
      asrLanguage: domElement.getAttribute("data-asr-language") || "en-US",
      azureKey: domElement.getAttribute("data-azure-key"),
    },
  };
  const [state, send] = useMachine(machine, {
    context: { ...machine.context, ...externalContext },
    devTools: process.env.NODE_ENV === "development" ? true : false,
    actions: {
      recStart: (context) => {
        context.asr.start();
        /* console.log('Ready to receive a voice input.'); */
      },
      recStop: (context) => {
        context.asr.abort();
        /* console.log('Recognition stopped.'); */
      },
      ttsStart: (context) => {
        let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${context.voice.name}">`;
        content =
          content +
          (process.env.REACT_APP_TTS_LEXICON
            ? `<lexicon uri="${process.env.REACT_APP_TTS_LEXICON}"/>`
            : "");
        content = content + `${context.ttsAgenda}</voice></speak>`;
        const utterance = new context.ttsUtterance(content);
        console.log("S>", context.ttsAgenda);
        utterance.voice = context.voice;
        utterance.onend = () => send("ENDSPEECH");
        context.tts.speak(utterance);
      },
      ttsStop: (context) => {
        /* console.log('TTS STOP...'); */
        context.tts.cancel();
      },
      ponyfillASR: (context) => {
        const { SpeechRecognition } = createSpeechRecognitionPonyfill({
          audioContext: context.audioCtx,
          credentials: {
            region: REGION,
            authorizationToken: context.azureAuthorizationToken,
          },
        });
        context.asr = new SpeechRecognition();
        context.asr.lang = process.env.REACT_APP_ASR_LANGUAGE || "en-US";
        context.asr.continuous = true;
        context.asr.interimResults = true;
        context.asr.onresult = function (event: any) {
          var result = event.results[0];
          if (result.isFinal) {
            send({
              type: "ASRRESULT",
              value: [
                {
                  utterance: result[0].transcript,
                  confidence: result[0].confidence,
                },
              ],
            });
          } else {
            send({ type: "STARTSPEECH" });
          }
        };
      },
    },
  });

  switch (true) {
    default:
      return (
        <div className="App">
          <ReactiveButton
            state={state}
            key={machine.id}
            alternative={{}}
            onClick={() => send("CLICK")}
          />
        </div>
      );
  }
}

const getAuthorizationToken = (azureKey: string) =>
  fetch(
    new Request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
      },
    })
  ).then((data) => data.text());

const rootElement = document.getElementById("speechstate");
ReactDOM.render(<App domElement={rootElement} />, rootElement);
