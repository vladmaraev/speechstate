declare module "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";
declare module "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

interface MySpeechRecognition extends SpeechRecognition {
  new ();
}

interface MySpeechGrammarList extends SpeechGrammarList {
  new ();
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

interface SSContext {
  settings: Settings;
  audioContext?: AudioContext;
  asrRef?: any;
  ttsRef?: any;
}

type SSEventCommon =
  | { type: "PREPARE" }
  | { type: "PAUSE" }
  | { type: "CONTINUE" }
  | { type: "STOP" };

type SSEventTTS =
  | { type: "SPEAK"; value: Agenda }
  | { type: "TTS_READY" }
  | { type: "TTS_ERROR" }
  | { type: "TTS_PAUSED" }
  | { type: "ENDSPEECH" };

type SSEventASR =
  | { type: "ASR_READY" }
  | { type: "ASR_STARTED" }
  | { type: "ASR_PAUSED" }
  | { type: "ASR_NOINPUT_TIMEOUT" }
  | { type: "RECOGNISED"; value: Hypothesis[] }
  | { type: "LISTEN" };

type SSEvent = SSEventCommon | SSEventTTS | SSEventASR;

interface Agenda {
  utterance: string;
  voice?: string;
  streamURL?: string;
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

interface Hypothesis {
  utterance: string;
  confidence: number;
}

interface ASRParams {
  noInputTimeout?: number;
  completeTimeout?: number;
  locale?: string;
  hints?: string[];
}

interface ASRContext {
  audioContext: AudioContext;
  azureCredentials: string | AzureCredentials;
  azureAuthorizationToken?: string;
  locale: string;
  asrDefaultNoInputTimeout: number;
  asrDefaultCompleteTimeout: number;
  wsaASR?: MySpeechRecognition;
  wsaASRinstance?: MySpeechRecognition;
  wsaGrammarList?: MySpeechGrammarList;
  result?: Hypothesis[];
  params?: ASRParams;
}

type ASREvent =
  | SSEventCommon
  | {
      type: "READY";
      value: {
        wsaASR: MySpeechRecognition;
        wsaGrammarList: MySpeechGrammarList;
      };
    }
  | { type: "ERROR" }
  | { type: "NOINPUT" }
  | {
      type: "START";
      value?: ASRParams;
    }
  | { type: "STARTED"; value: { wsaASRinstance: MySpeechRecognition } }
  | { type: "STARTSPEECH" }
  | { type: "RECOGNISED" }
  | { type: "RESULT"; value: Hypothesis[] };

type TTSEvent =
  | SSEventCommon
  | {
      type: "READY";
      value: {
        wsaTTS: SpeechSynthesis;
        wsaUtt: MySpeechSynthesisUtterance;
      };
    }
  | { type: "ERROR" }
  | { type: "START"; value: Agenda }
  | { type: "END" };
