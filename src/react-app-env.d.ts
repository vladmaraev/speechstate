/// <reference types="react-scripts" />

declare module 'react-speech-kit';
declare module 'web-speech-cognitive-services/lib/SpeechServices';
declare module 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText';

interface Hypothesis {
    "utterance": string;
    "confidence": number
}

interface SDSContext {
    recResult: Hypothesis[];
    nluData: any;
    ttsAgenda: string;
    query: string;
    snippet: string;
    sessionId: string;
    tdmUtterance: string;
    tdmPassivity: number;
    tdmActions: any;
}

type SDSEvent =
    | { type: 'CLICK' }
    | { type: 'STARTSPEECH' }
    | { type: 'RECOGNISED' }
    | { type: 'ASRRESULT', value: Hypothesis[] }
    | { type: 'ENDSPEECH' }
    | { type: 'LISTEN' }
    | { type: 'TIMEOUT' }
    | { type: 'SPEAK', value: string };
