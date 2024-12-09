import { SpeechSynthesisEventProps } from "@vladmaraev/web-speech-cognitive-services-davi";

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
  newTokenInterval?: number;
}

export interface Agenda {
  utterance: string;
  voice?: string;
  stream?: string;
  cache?: string;
  fillerDelay?: number;
  visemes?: boolean;
  audioURL?: string;
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

type SSEventExtOut =
  | { type: "ASR_NOINPUT" }
  | { type: "ASRTTS_READY" }
  | { type: "ASR_STARTED" }
  | { type: "TTS_STARTED" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "LISTEN_COMPLETE" }
  | { type: "RECOGNISED"; value: Hypothesis[]; nluValue?: any }
  | { type: "VISEME"; value: any }
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
  | { type: "READY"; value: { asr: SpeechRecognition } }
  | { type: "NEW_TOKEN"; value: string }
  | { type: "ERROR" }
  | { type: "NOINPUT" }
  | { type: "CONTROL" }
  | {
      type: "START";
      value?: RecogniseParameters;
    }
  | { type: "STARTED"; value: { wsaASRinstance: MySpeechRecognition } }
  | { type: "STARTSPEECH" }
  | { type: "RECOGNISED"; value: Hypothesis[] }
  | { type: "STOP" }
  | { type: "LISTEN_COMPLETE" }
  | { type: "RESULT"; value: Hypothesis[] };

export interface ASRContext extends ASRInit {
  result?: Hypothesis[];
  nluResult?: any; // TODO
  params?: RecogniseParameters;
}

export interface ASRInit {
  azureAuthorizationToken: string;
  asrDefaultCompleteTimeout: number;
  asrDefaultNoInputTimeout: number;
  locale: string;
  audioContext: AudioContext;
  azureRegion: string;
  speechRecognitionEndpointId?: string;
  azureLanguageCredentials?: AzureLanguageCredentials;
}

export interface ASRInstanceInput {
  asr: SpeechRecognition;
  locale?: string;
}

export interface ASRPonyfillInput extends RecogniseParameters {
  audioContext: AudioContext;
  azureAuthorizationToken: string;
  azureRegion: string;
  speechRecognitionEndpointId?: string;
  locale: string;
}

export interface ConstructableSpeechSynthesisUtterance
  extends SpeechSynthesisUtterance {
  new (s: string);
}

export interface TTSInit {
  azureAuthorizationToken: string;
  audioContext: AudioContext;
  azureRegion: string;
  ttsDefaultVoice: string;
  ttsLexicon?: string;
  locale: string;
}

export interface TTSContext extends TTSInit {
  wsaTTS?: SpeechSynthesis;
  wsaVoice?: SpeechSynthesisVoice;
  wsaUtt?: ConstructableSpeechSynthesisUtterance;
  agenda?: Agenda;
  buffer?: string;
  currentVoice?: string;
  utteranceFromStream?: string;
  audioBuffer?: AudioBuffer;
  audioBufferSourceNode?: AudioBufferSourceNode;
}

export interface TTSPonyfillInput {
  audioContext: AudioContext;
  azureRegion: string;
  azureAuthorizationToken: string;
}

export type TTSEvent =
  | { type: "PREPARE" }
  | { type: "NEW_TOKEN"; value: string }
  | { type: "CONTROL" }
  | { type: "STOP" }
  | {
      type: "READY";
      value: {
        wsaTTS: SpeechSynthesis;
        wsaUtt: ConstructableSpeechSynthesisUtterance;
      };
    }
  | { type: "ERROR" }
  | { type: "SPEAK"; value: Agenda }
  | { type: "TTS_STARTED"; value?: AudioBufferSourceNode }
  | { type: "STREAMING_CHUNK"; value: string }
  | { type: "STREAMING_SET_VOICE"; value: string }
  | { type: "STREAMING_SET_PERSONA"; value: string }
  | { type: "STREAMING_DONE" }
  | { type: "SPEAK_COMPLETE" }
  | { type: "VISEME"; value: SpeechSynthesisEventProps }
  | { type: "FURHAT_BLENDSHAPES"; value: Frame[] };

export type Frame = { time: number[]; params: any };
export type Animation = { FrameIndex: number; BlendShapes: number[][] };
