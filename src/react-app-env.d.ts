/// <reference types="react-scripts" />

declare module 'react-speech-kit';
declare module 'web-speech-cognitive-services/lib/SpeechServices';
declare module 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText';

interface Hypothesis {
    "utterance": string;
    "confidence": number
}

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
    new(s: string);
}

interface SDSContext {
    asr: AzureSpeechRecognition;
    tts: SpeechSynthesis;
    voice: SpeechSynthesisVoice;
    ttsUtterance: MySpeechSynthesisUtterance;
    recResult: Hypothesis[];
    nluData: any;
    ttsAgenda: string;
    query: string;
    snippet: string;
    sessionId: string;
    tdmUtterance: string;
    tdmPassivity: number;
    tdmActions: any;
    azureAuthorizationToken: string;
}

type SDSEvent =
    | { type: 'TTS_ERROR' }
    | { type: 'CLICK' }
    | { type: 'STARTSPEECH' }
    | { type: 'RECOGNISED' }
    | { type: 'ASRRESULT', value: Hypothesis[] }
    | { type: 'ENDSPEECH' }
    | { type: 'LISTEN' }
    | { type: 'TIMEOUT' }
    | { type: 'SPEAK', value: string };