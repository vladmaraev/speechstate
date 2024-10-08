export interface AzureSpeechCredentials {
  endpoint: string;
  key: string;
}

/**
 * @deprecated use `AzureSpeechCredentials` instead
 */
export interface AzureCredentials extends AzureSpeechCredentials {}

export interface AzureLanguageCredentials {
  endpoint: string;
  key: string;
  projectName: string;
  deploymentName: string;
}

export interface Settings {
  locale?: string;
  azureCredentials: string | AzureCredentials | AzureSpeechCredentials;
  azureRegion: string;
  azureLanguageCredentials?: AzureLanguageCredentials;
  asrDefaultCompleteTimeout?: number;
  asrDefaultNoInputTimeout?: number;
  speechRecognitionEndpointId?: string;
  ttsDefaultVoice?: string;
  ttsLexicon?: string;
}

export interface Agenda {
  utterance: string;
  voice?: string;
  stream?: string;
  fillerDelay?: number;
}

export interface Hypothesis {
  utterance: string;
  confidence: number;
}

export interface RecogniseParameters {
  noInputTimeout?: number;
  completeTimeout?: number;
  locale?: string;
  hints?: string[];
  nlu?: boolean | AzureLanguageCredentials;
}

/** events sent to the spawned `speechstate` machine **/
type SSEventExtIn =
  | { type: "PREPARE" }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "LISTEN"; value: RecogniseParameters };

/** for sendParent, not type-checked */
type SSEventExtOut =
  | { type: "ASR_NOINPUT" }
  | { type: "ASRTTS_READY" }
  | { type: "ASR_STARTED" }
  | { type: "TTS_STARTED" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "RECOGNISED"; value: Hypothesis[]; nluValue?: any }
  | { type: "STREAMING_SET_PERSONA"; value: string };

type SSEventIntIn =
  | { type: "TTS_READY" }
  | { type: "ASR_READY" }
  | { type: "TTS_ERROR" };

export type SpeechStateExternalEvent = SSEventExtIn | SSEventExtOut;
export type SpeechStateEvent = SSEventIntIn | SpeechStateExternalEvent;

export interface MySpeechRecognition extends SpeechRecognition {
  new ();
}
export interface MySpeechGrammarList extends SpeechGrammarList {
  new ();
}

export type ASREvent =
  | {
      type: "READY";
      value: {
        wsaASR: MySpeechRecognition;
        wsaGrammarList: MySpeechGrammarList;
      };
    }
  | { type: "ERROR" }
  | { type: "NOINPUT" }
  | { type: "CONTROL" }
  | {
      type: "START";
      value?: RecogniseParameters;
    }
  | { type: "STARTED"; value: { wsaASRinstance: MySpeechRecognition } }
  | { type: "STARTSPEECH" }
  | { type: "RECOGNISED" }
  | { type: "RESULT"; value: Hypothesis[] };

export interface ASRContext extends ASRInit {
  azureAuthorizationToken?: string;
  wsaASR?: MySpeechRecognition;
  wsaASRinstance?: MySpeechRecognition;
  wsaGrammarList?: MySpeechGrammarList;
  result?: Hypothesis[];
  nluResult?: any; // TODO
  params?: RecogniseParameters;
}

export interface ASRInit {
  asrDefaultCompleteTimeout: number;
  asrDefaultNoInputTimeout: number;
  locale: string;
  audioContext: AudioContext;
  azureCredentials: string | AzureSpeechCredentials;
  azureRegion: string;
  speechRecognitionEndpointId?: string;
  azureLanguageCredentials?: AzureLanguageCredentials;
}

export interface ASRPonyfillInput {
  audioContext: AudioContext;
  azureAuthorizationToken: string;
  azureRegion: string;
  speechRecognitionEndpointId?: string;
}

export interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

export interface TTSInit {
  audioContext: AudioContext;
  azureCredentials: string | AzureSpeechCredentials;
  azureRegion: string;
  ttsDefaultVoice: string;
  ttsLexicon?: string;
  locale: string;
}

export interface TTSContext extends TTSInit {
  azureAuthorizationToken?: string;
  wsaTTS?: SpeechSynthesis;
  wsaVoice?: SpeechSynthesisVoice;
  wsaUtt?: MySpeechSynthesisUtterance;
  agenda?: Agenda;
  buffer?: string;
  currentVoice?: string;
  utteranceFromStream?: string;
}

export interface TTSPonyfillInput {
  audioContext: AudioContext;
  azureRegion: string;
  azureAuthorizationToken: string;
}

export type TTSEvent =
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
  | { type: "TTS_STARTED" }
  | { type: "STREAMING_CHUNK"; value: string }
  | { type: "STREAMING_SET_VOICE"; value: string }
  | { type: "STREAMING_SET_PERSONA"; value: string }
  | { type: "STREAMING_DONE" }
  | { type: "SPEAK_COMPLETE" };
