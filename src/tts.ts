import {
  createMachine,
  sendParent,
  assign,
  fromPromise,
  fromCallback,
} from "xstate";

import { getToken } from "./getToken";

import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

const REGION = "northeurope";

export const ttsMachine = createMachine(
  {
    id: "tts",
    types: {
      context: {} as TTSContext,
      events: {} as TTSEvent,
    },
    context: ({ input }) => ({
      ttsDefaultVoice: input.ttsDefaultVoice || "en-US-DavisNeural",
      audioContext: input.audioContext,
      azureCredentials: input.azureCredentials,
    }),

    initial: "getToken",
    on: {
      READY: {
        target: ".ready",
        actions: [
          assign({
            wsaTTS: ({ event }) => event.value.wsaTTS,
            wsaUtt: ({ event }) => event.value.wsaUtt,
          }),
          sendParent({ type: "TTS_READY" }),
        ],
      },
      ERROR: { actions: sendParent({ type: "TTS_ERROR" }) },
    },
    states: {
      ready: {
        on: {
          START: {
            target: "speaking",
            actions: assign({ agenda: ({ event }) => event.value }),
          },
        },
      },
      fail: {},
      getToken: {
        invoke: {
          id: "getAuthorizationToken",
          input: ({ context }) => ({
            credentials: context.azureCredentials,
          }),
          src: "getToken",
          onDone: {
            target: "ponyfill",
            actions: [
              assign(({ event }) => {
                return { azureAuthorizationToken: event.output };
              }),
            ],
          },
          onError: {
            actions: ({ event }) =>
              console.error("[TTS] getToken error", event),
            target: "fail",
          },
        },
      },
      ponyfill: {
        invoke: {
          id: "ponyTTS",
          src: "ponyfill",
          input: ({ context }) => ({
            audioContext: context.audioContext,
            azureAuthorizationToken: context.azureAuthorizationToken,
            voice: context.ttsVoice,
          }),
        },
      },
      speaking: {
        initial: "go",
        on: {
          STOP: {
            target: "ready",
          },
          END: {
            target: "ready",
          },
        },
        exit: sendParent({ type: "ENDSPEECH" }),
        states: {
          go: {
            invoke: {
              src: "start",
              input: ({ context }) => ({
                wsaTTS: context.wsaTTS,
                wsaUtt: context.wsaUtt,
                ttsLexicon: context.ttsLexicon,
                voice: context.agenda.voice || context.ttsDefaultVoice,
                streamURL: context.agenda.streamURL,
                utterance: context.agenda.utterance,
              }),
            },
            on: {
              PAUSE: "paused",
            },
            exit: "ttsStop",
          },
          paused: {
            on: {
              CONTINUE: "go",
            },
          },
        },
      },
    },
  },
  {
    actions: {
      ttsStop: ({ context }) => {
        context.wsaTTS!.cancel();
      },
    },
    actors: {
      getToken: getToken,
      ponyfill: fromCallback((sendBack, _receive, { input }) => {
        const ponyfill = createSpeechSynthesisPonyfill({
          audioContext: input.audioContext,
          credentials: {
            region: REGION, // TODO
            authorizationToken: input.azureAuthorizationToken,
          },
        });
        const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
        const tts = speechSynthesis;
        const ttsUtterance = SpeechSynthesisUtterance;
        tts.addEventListener("voiceschanged", () => {
          const voices = tts.getVoices();
          if (voices.length > 0) {
            console.debug("[TTS] READY");
            sendBack({
              type: "READY",
              value: { wsaTTS: tts, wsaUtt: ttsUtterance },
            });
          } else {
            console.error("[TTS] No voices available");
            sendBack({ type: "ERROR" });
          }
        });
      }),
      start: fromCallback((sendBack, _receive, { input }) => {
        if (input.streamURL) {
          {
            const stream = new EventSource(input.streamURL);
            let buffer = "";
            stream.onmessage = function (event: any) {
              let chunk = event.data;
              console.debug("🍰", chunk);
              if (chunk !== "[CLEAR]") {
                buffer = buffer + chunk;
                if (buffer.includes("[DONE]")) {
                  stream.close();
                  buffer = buffer.replace("[DONE]", "");
                  const content = wrapSSML(
                    buffer || "",
                    input.voice,
                    input.ttsLexicon,
                    1 // todo
                  );
                  const utterance = new input.wsaUtt!(content);
                  input.wsaTTS.speak(utterance);
                  console.log(`S(chunk)> ${buffer} [done speaking]`);
                  buffer = "";
                  utterance.onend = () => {
                    sendBack({ type: "END" });
                    console.debug("[TTS] END");
                  };
                }

                const re = /(,\s)|([!.?](\s|$))/;
                const m = buffer.match(re);
                if (m) {
                  const sep = m[0];
                  const utt = buffer.split(sep)[0] + sep;
                  buffer = buffer.split(sep).slice(1).join(sep);
                  const content = wrapSSML(
                    utt,
                    input.voice,
                    input.ttsLexicon,
                    1 // todo
                  );
                  const utterance = new input.wsaUtt!(content);
                  console.log("S(chunk)>", utt);
                  input.wsaTTS.speak(utterance);
                }
              }
            };
          }
        } else {
          if (["", " "].includes(input.utterance)) {
            console.debug("[TTS] SPEAK: ", input.utterance);
            input.wsaTTS.speak("");
          } else {
            const content = wrapSSML(
              input.utterance,
              input.voice,
              input.ttsLexicon,
              1
            ); // todo speech rate;
            const utterance = new input.wsaUtt!(content);
            console.debug("[TTS] SPEAK: ", input.utterance);
            utterance.onend = () => {
              sendBack({ type: "END" });
              console.debug("[TTS] END");
            };
            input.wsaTTS.speak(utterance);
          }
        }
      }),
    },
  }
);

const wrapSSML = (
  text: string,
  voice: string,
  lexicon: string,
  speechRate: number
): string => {
  let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}">`;
  if (lexicon) {
    content = content + `<lexicon uri="${lexicon}"/>`;
  }
  content =
    content +
    `<prosody rate="${speechRate}">` +
    `${text}</prosody></voice></speak>`;
  return content;
};