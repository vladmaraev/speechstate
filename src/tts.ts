import { createMachine, sendParent, assign, fromCallback } from "xstate";

import { getToken } from "./getToken";
import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";
const REGION = "northeurope";

import { AzureCredentials, Agenda } from "./types";

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

interface TTSContext {
  audioContext: AudioContext;
  azureCredentials: string | AzureCredentials;
  azureAuthorizationToken?: string;
  ttsDefaultVoice: string;
  ttsLexicon?: string;
  wsaTTS?: SpeechSynthesis;
  wsaVoice?: SpeechSynthesisVoice;
  wsaUtt?: MySpeechSynthesisUtterance;
  agenda?: Agenda;
}

type TTSEvent =
  | { type: "PREPARE" }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | {
      type: "READY";
      value: {
        wsaTTS: SpeechSynthesis;
        wsaUtt: MySpeechSynthesisUtterance;
      };
    }
  | { type: "ERROR" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "SPEAK_COMPLETE" };

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

    initial: "GetToken",
    on: {
      READY: {
        target: ".Ready",
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
      Ready: {
        on: {
          SPEAK: {
            target: "Speaking",
            actions: assign({ agenda: ({ event }) => event.value }),
          },
        },
      },
      Fail: {},
      GetToken: {
        invoke: {
          id: "getAuthorizationToken",
          input: ({ context }) => ({
            credentials: context.azureCredentials,
          }),
          src: "getToken",
          onDone: {
            target: "Ponyfill",
            actions: [
              assign(({ event }) => {
                return { azureAuthorizationToken: event.output };
              }),
            ],
          },
          onError: {
            actions: ({ event }) =>
              console.error("[TTS] getToken error", event),
            target: "Fail",
          },
        },
      },
      Ponyfill: {
        invoke: {
          id: "ponyTTS",
          src: "ponyfill",
          input: ({ context }) => ({
            audioContext: context.audioContext,
            azureAuthorizationToken: context.azureAuthorizationToken,
          }),
        },
      },
      Speaking: {
        initial: "Go",
        on: {
          STOP: {
            target: "Ready",
          },
          SPEAK_COMPLETE: {
            target: "Ready",
          },
        },
        exit: sendParent({ type: "SPEAK_COMPLETE" }),
        states: {
          Go: {
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
              CONTROL: "Paused",
            },
            exit: "ttsStop",
          },
          Paused: {
            on: {
              CONTROL: "Go",
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
      ponyfill: fromCallback(({ sendBack, input }) => {
        const ponyfill = createSpeechSynthesisPonyfill({
          audioContext: (input as any).audioContext,
          credentials: {
            region: REGION, // TODO
            authorizationToken: (input as any).azureAuthorizationToken,
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
      start: fromCallback(({ sendBack, input }) => {
        if (["", " "].includes((input as any).utterance)) {
          console.debug("[TTS] SPEAK: ", (input as any).utterance);
          (input as any).wsaTTS.speak("");
        } else {
          console.debug("[TTS] SPEAK: ", (input as any).utterance);
          const content = wrapSSML(
            (input as any).utterance,
            (input as any).voice,
            (input as any).ttsLexicon,
            1,
          ); // todo speech rate;
          const utterance = new (input as any).wsaUtt!(content);
          utterance.addEventListener("end", () => {
            sendBack({ type: "SPEAK_COMPLETE" });
            console.debug("[TTS] SPEAK_COMPLETE");
          });
          (input as any).wsaTTS.speak(utterance);
        }
      }),
    },
  },
);

const wrapSSML = (
  text: string,
  voice: string,
  lexicon: string,
  speechRate: number,
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
