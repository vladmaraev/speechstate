import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { inspect } from "@xstate/inspect";
import { useSpeechSynthesis, useSpeechRecognition } from 'react-speech-kit';

/* import { dmMachine } from "./dmColourChanger"; */


inspect({
    url: "https://statecharts.io/inspect",
    iframe: false
});

const { send, cancel } = actions;

const proxyurl = "https://cors-anywhere.herokuapp.com/";
const tdmEndpoint = "https://sourdough-for-dummies-orchestration-pipeline.eu2.ddd.tala.cloud/interact"
const tdmSession = {
    "session": {
        "my_frontend": {
            "user_id": "speechstate",
            "position": {
                "latitude": "57.699188",
                "longitude": "11.948313"
            }
        }
    }
}

const startSession = {
    "version": "3.3",
    "session": tdmSession,
    "request": {
        "start_session": {}
    }
}

const defaultPassivity = 5
const passivity = (sessionId: string) => ({
    "version": "3.3",
    "session": { "session_id": sessionId },
    "request": {
        "passivity": {}
    }
})

const nlInput = (sessionId: string, hypotheses: Hypothesis[]) => ({
    "version": "3.3",
    "session": { "session_id": sessionId },
    "request": {
        "natural_language_input": {
            "modality": "speech",
            "hypotheses": hypotheses
        }
    }
})


const tdmRequest = (requestBody: any) => (fetch(new Request(proxyurl + tdmEndpoint, {
    method: 'POST',
    headers: {
        'Content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
})).then(data => data.json()))

const isEndSession = (context: SDSContext) => {
    return context.tdmActions.some((item: any) => item.name === 'EndSession')
};

const machine = Machine<SDSContext, any, SDSEvent>({
    id: 'root',
    type: 'parallel',
    states: {
        dm: {
            initial: 'init',
            states: {
                init: {
                    on: {
                        CLICK: 'tdm'
                    }
                },
                tdm: {
                    initial: 'start',
                    states: {
                        start: {
                            invoke: {
                                id: "startSession",
                                src: (_ctx, _evt) => tdmRequest(startSession),
                                onDone: [
                                    {
                                        target: 'utter',
                                        actions: assign({
                                            sessionId: (_ctx, event) => event.data.session.session_id,
                                            tdmUtterance: (_ctx, event) => event.data.output.utterance,
                                            tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
                                            tdmActions: (_ctx, event) => event.data.output.actions,
                                        }),
                                        cond: (_ctx, event) => event.data.output
                                    },
                                    {
                                        target: 'fail'
                                    }
                                ],
                                onError: { target: 'fail' }
                            }
                        },
                        utter: {
                            initial: 'prompt',
                            on: {
                                RECOGNISED: 'next',
                                TIMEOUT: 'passivity'
                            },
                            states: {
                                prompt: {
                                    entry: send((context: SDSContext) => ({
                                        type: "SPEAK", value: context.tdmUtterance
                                    })),
                                    on: {
                                        ENDSPEECH:
                                            [
                                                {
                                                    target: '#root.dm.init',
                                                    cond: (context, _evnt) => context.tdmActions.some((item: any) => item.name === 'EndSession')
                                                },
                                                { target: 'ask' }
                                            ]

                                    }
                                },
                                ask: {
                                    entry: [
                                        send('LISTEN'),
                                        send(
                                            { type: 'TIMEOUT' },
                                            { delay: (context) => (1000 * (defaultPassivity || context.tdmPassivity)), id: 'timeout' }
                                        )
                                    ],
                                    exit: cancel('timeout')
                                },
                            }
                        },
                        next: {
                            invoke: {
                                id: "nlInput",
                                src: (context, _evt) => tdmRequest(nlInput(context.sessionId, context.recResult)),
                                onDone: [
                                    {
                                        target: 'utter',
                                        actions:
                                            assign({
                                                tdmUtterance: (_ctx, event) => event.data.output.utterance,
                                                tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
                                                tdmActions: (_ctx, event) => event.data.output.actions,
                                            }),
                                        cond: (_ctx, event) => event.data.output
                                    },
                                    {
                                        target: 'fail'
                                    }
                                ],
                                onError: { target: 'fail' }
                            }

                        },
                        passivity: {
                            invoke: {
                                id: "passivity",
                                src: (context, _evt) => tdmRequest(passivity(context.sessionId)),
                                onDone: [
                                    {
                                        target: 'utter',
                                        actions: assign({
                                            tdmUtterance: (_ctx, event) => event.data.output.utterance,
                                            tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
                                            tdmActions: (_ctx, event) => event.data.output.actions,
                                        }),
                                        cond: (_ctx, event) => event.data.output
                                    },
                                    {
                                        target: 'fail'
                                    }
                                ],
                                onError: { target: 'fail' }
                            }

                        },
                        fail: {}
                    },
                },
            },
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
                    initial: 'progress',
                    entry: 'recStart',
                    exit: 'recStop',
                    on: {
                        ASRRESULT: {
                            actions: ['recLogResult',
                                assign((_context, event) => {
                                    return {
                                        recResult: [{
                                            "utterance": event.value,
                                            "confidence": 1
                                        }]
                                    }
                                })],
                            target: '.match'
                        },
                        RECOGNISED: 'idle',
                        TIMEOUT: 'idle'


                    },
                    states: {
                        progress: {
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
    const { listen, listening, stop } = useSpeechRecognition({
        onResult: (result: any) => {
            send({ type: "ASRRESULT", value: result });
        },
    });
    const [current, send, service] = useMachine(machine, {
        devTools: true,
        actions: {
            recStart: asEffect(() => {
                console.log('Ready to receive voice input.');
                listen({
                    interimResults: false,
                    continuous: true
                });
            }),
            recStop: asEffect(() => {
                console.log('Recognition stopped.');
                stop()
            }),
            /* changeColour: asEffect((context) => {
             *     console.log('Repainting...');
             *     document.body.style.background = context.recResult;
             * }), */
            ttsStart: asEffect((context, effect) => {
                console.log('Speaking...');
                speak({ text: context.ttsAgenda })
            }),
            ttsCancel: asEffect((context, effect) => {
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

