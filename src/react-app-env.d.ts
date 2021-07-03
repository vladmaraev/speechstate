/// <reference types="react-scripts" />

declare module 'react-speech-kit';

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
    | { type: 'RECOGNISED' }
    | { type: 'ASRRESULT', value: string }
    | { type: 'ENDSPEECH' }
    | { type: 'LISTEN' }
    | { type: 'TIMEOUT' }
    | { type: 'SPEAK', value: string };
