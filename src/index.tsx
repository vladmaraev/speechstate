import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { inspect } from "@xstate/inspect";
import { useSpeechSynthesis } from 'react-speech-kit';
import SpeechRecognition from 'react-speech-recognition';

import createSpeechRecognitionPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText'

import { dmMachine } from "./tdmClient";
/* import { dmMachine } from "./dmColourChanger"; */


inspect({
    url: "https://statecharts.io/inspect",
    iframe: false
});

const { send, cancel } = actions;

const defaultPassivity = 5

const TOKEN_ENDPOINT = 'https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken'
const REGION = 'northeurope'

const machine = Machine<SDSContext, any, SDSEvent>({
    id: 'root',
    type: 'parallel',
    states: {
        dm: {
            ...dmMachine
        },

        asrtts: {
            initial: 'idle',
            states: {
                idle: {
                    on: {
                        LISTEN: 'recognising',
                        SPEAK: {
                            target: 'speaking',
                            actions: assign((_context, event) => { return { ttsAgenda: event.value } })
                        }
                    }
                },
                recognising: {
                    initial: 'noinput',
                    entry: 'recStart',
                    exit: 'recStop',
                    on: {
                        ASRRESULT: {
                            actions: ['recLogResult',
                                assign((_context, event) => {
                                    return {
                                        recResult: event.value
                                    }
                                })],
                            target: '.match'
                        },
                        RECOGNISED: 'idle',
                    },
                    states: {
                        noinput: {
                            entry: send(
                                { type: 'TIMEOUT' },
                                { delay: (context) => (1000 * (defaultPassivity || context.tdmPassivity)), id: 'timeout' }
                            ),
                            on: {
                                TIMEOUT: '#root.asrtts.idle',
                                STARTSPEECH: 'inprogress'
                            },
                            exit: cancel('timeout')
                        },
                        inprogress: {
                        },
                        match: {
                            entry: send('RECOGNISED'),
                        },
                    }
                },
                speaking: {
                    entry: 'ttsStart',
                    on: {
                        ENDSPEECH: 'idle',
                    }
                }
            }
        }
    },
},
    {
        actions: {
            recLogResult: (context: SDSContext) => {
                /* context.recResult = event.recResult; */
                console.log('<< ASR: ' + context.recResult[0]["utterance"]);
            },
            test: () => {
                console.log('test')
            },
            logIntent: (context: SDSContext) => {
                /* context.nluData = event.data */
                console.log('<< NLU intent: ' + context.nluData.intent.name)
            }
        },
    });



interface Props extends React.HTMLAttributes<HTMLElement> {
    state: State<SDSContext, any, any, any>;
}
const ReactiveButton = (props: Props): JSX.Element => {
    switch (true) {
        case props.state.matches({ asrtts: 'recognising' }):
            return (
                <button type="button" className="glow-on-hover"
                    style={{ animation: "glowing 20s linear" }} {...props}>
                    Listening...
                </button>
            );
        case props.state.matches({ asrtts: 'speaking' }):
            return (
                <button type="button" className="glow-on-hover"
                    style={{ animation: "bordering 1s infinite" }} {...props}>
                    Speaking...
                </button>
            );
        case props.state.matches({ dm: 'fail' }):
            return (
                <button type="button" className="glow-on-hover"
                    {...props}>
                    FAILURE! reload the page
                </button>
            );

        default:
            return (
                <button type="button" className="glow-on-hover" {...props}>
                    Click to start
                </button >
            );
    }
}



function App() {

    const { speak, cancel, speaking } = useSpeechSynthesis({
        onEnd: () => {
            send('ENDSPEECH');
        },
    });
    /* const { listen, _listening, stop } = useSpeechRecognition({
     *     onResult: (result: any) => {
     *         send({ type: "ASRRESULT", value: result });
     *     },
     * }); */

    const startListening = () => {
        SpeechRecognition.startListening({
            continuous: true,
            language: 'en-US'
        });
    }
    const stopListening = () => {
        SpeechRecognition.stopListening()
    }

    React.useEffect(() => {
        async function fetchASR() {
            const response = await fetch(TOKEN_ENDPOINT, {
                method: 'POST',
                headers: { 'Ocp-Apim-Subscription-Key': process.env.REACT_APP_SUBSCRIPTION_KEY! }
            });
            const authorizationToken = await response.text();
            const
                { SpeechRecognition: AzureSpeechRecognition }
                    = await createSpeechRecognitionPonyfill({
                        credentials: {
                            region: REGION,
                            authorizationToken: authorizationToken,
                        }
                    });
            SpeechRecognition.applyPolyfill(AzureSpeechRecognition);
            const rec = SpeechRecognition.getRecognition()
            rec!.onresult = function(event: any) {
                console.log(event.results)
                var result = event.results[0]
                if (result.isFinal) {
                    send({
                        type: "ASRRESULT", value:
                            [{
                                "utterance": result[0].transcript,
                                "confidence": result[0].confidence
                            }]
                    })
                } else {
                    send({ type: "STARTSPEECH" });
                }
            }
        }
        fetchASR()
    }, []
    )


    const [current, send, service] = useMachine(machine, {
        devTools: true,
        actions: {
            loadSpeechRecognition: asEffect(async () => {

            }),
            recStart: asEffect(() => {
                console.log('Ready to receive a voice input.');
                startListening()
                /* speechRecognition.start() */
            }),

            recStop: asEffect(() => {
                console.log('Recognition stopped.');
                stopListening()
            }),
            ttsStart: asEffect((context) => {
                console.log('Speaking...');
                speak({ text: context.ttsAgenda })
            }),
            ttsCancel: asEffect(() => {
                console.log('TTS STOP...');
                cancel()
            })
            /* speak: asEffect((context) => {
             * console.log('Speaking...');
             *     speak({text: context.ttsAgenda })
             * } */
        }
    });


    return (
        <div className="App">
            <ReactiveButton state={current} onClick={() => send('CLICK')} />
        </div>
    )
};



const rootElement = document.getElementById("root");
ReactDOM.render(
    <App />,
    rootElement);


