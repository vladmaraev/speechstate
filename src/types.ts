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
  ttsFillers?: string[];
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
  | { type: "RECOGNISED"; value: Hypothesis[]; nluValue?: any };

type SSEventIntIn =
  | { type: "TTS_READY" }
  | { type: "ASR_READY" }
  | { type: "TTS_ERROR" };

export type SpeechStateExternalEvent = SSEventExtIn | SSEventExtOut;
export type SpeechStateEvent = SSEventIntIn | SpeechStateExternalEvent;
