declare module "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";
declare module "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

interface AzureCredentials {
  endpoint: string;
  key: string;
}

interface Settings {
  locale: string;
  azureCredentials: string | AzureCredentials;
  asrDefaultCompleteTimeout: number;
}

interface SDSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
}

type SDSEventCommon =
  | { type: "PREPARE" }
  | { type: "PAUSE" }
  | { type: "CONTINUE" }
  | { type: "STOP" };

type SDSEventTTS =
  | { type: "SPEAK"; value: Agenda }
  | { type: "TTS_READY" }
  | { type: "TTS_ERROR" }
  | { type: "ENDSPEECH" };

type SDSEvent =
  | SDSEventCommon
  | SDSEventTTS
  | { type: "ASR_READY" }
  | { type: "ASR_STARTED" }
  | { type: "ASR_NOINPUT_TIMEOUT" }
  | { type: "RECOGNISED"; value: Hypothesis[] }
  | { type: "LISTEN" };

interface Agenda {
  utterance: string;
  voice?: string;
  streamURL?: string;
}

interface TTSContext {
  audioContext: AudioContext;
  azureCredentials: string | AzureCredentials;
  ttsDefaultVoice: string;
  ttsLexicon?: string;
  azureAuthorizationToken?: string;
  wsaTTS?: SpeechSynthesis;
  wsaVoice?: SpeechSynthesisVoice;
  wsaUtt?: MySpeechSynthesisUtterance;
  agenda?: Agenda;
}

type TTSEvent =
  | {
      type: "READY";
      value: {
        wsaTTS: SpeechSynthesis;
        wsaUtt: MySpeechSynthesisUtterance;
      };
    }
  | { type: "ERROR" }
  | { type: "START"; value: Agenda }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "CONTINUE" }
  | { type: "END" };

interface Hypothesis {
  utterance: string;
  confidence: number;
}

interface ASRContext {
  audioContext: AudioContext;
  azureCredentials: string | AzureCredentials;
  azureAuthorizationToken?: string;
  language: string;
  asrDefaultNoInputTimeout: number;
  asrDefaultCompleteTimeout: number;
  wsaASR?: SpeechRecognition;
  result?: Hypothesis[];
}

type ASREvent =
  | { type: "READY" }
  | {
      type: "START";
      value?: { noinputTimeout: number; completeTimeout: number };
    }
  | { type: "STARTED" }
  | { type: "STARTSPEECH" }
  | { type: "RESULT"; value: Hypothesis[] };
