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
