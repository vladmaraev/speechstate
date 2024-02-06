export interface AzureCredentials {
  endpoint: string;
  key: string;
}

export interface Settings {
  locale?: string;
  azureCredentials: string | AzureCredentials;
  asrDefaultCompleteTimeout?: number;
  asrDefaultNoInputTimeout?: number;
  ttsDefaultVoice?: string;
  speechRecognitionEndpointId?: string;
}

export interface Agenda {
  utterance: string;
  voice?: string;
  stream?: ReadableStream<string>;
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
}
