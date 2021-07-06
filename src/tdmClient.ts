import { MachineConfig, actions, assign } from "xstate";

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

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
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
});
