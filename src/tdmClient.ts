import { MachineConfig, actions, AssignAction } from "xstate";

const { send, assign, choose } = actions;


const tdmEndpoint = process.env.REACT_APP_TDM_ENDPOINT || "https://sourdough-for-dummies-orchestration-pipeline.eu2.ddd.tala.cloud/interact"
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

const hapticInput = (sessionId: string, expression: string) => ({
    "version": "3.3",
    "session": { "session_id": sessionId },
    "request": {
        "semantic_input": {
            "interpretations": [{
                "modality": "haptic",
                "moves": [{
                    "perception_confidence": 1,
                    "understanding_confidence": 1,
                    "semantic_expression": expression
                }]
            }]
        }
    }
})

const tdmRequest = (requestBody: any) => (fetch(new Request(tdmEndpoint, {
    method: 'POST',
    headers: {
        'Content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
})).then(data => data.json()))

const tdmAssign: AssignAction<SDSContext, any> = assign({
    sessionId: (_ctx, event) => event.data.session.session_id,
    tdmAll: (_ctx, event) => event.data,
    tdmUtterance: (_ctx, event) => event.data.output.utterance,
    tdmVisualOutputInfo: (_ctx, event) => (event.data.output.visual_output || [{}])[0].visual_information,
    tdmExpectedAlternatives: (_ctx, event) => (event.data.context.expected_input || {}).alternatives,
    tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
    tdmActions: (_ctx, event) => event.data.output.actions,
})


const maybeAlternatives = choose<SDSContext, SDSEvent>([
    {
        cond: (context) => { return (context.tdmExpectedAlternatives || [{}])[0].visual_information },
        actions: [send({ type: "SHOW_ALTERNATIVES" })]
    },
])

export const tdmDmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
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
                                actions: tdmAssign,
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
                        SELECT: {
                            target: 'nextHaptic',
                            actions: assign({ hapticInput: (_ctx, event) => event.value })
                        },
                        TIMEOUT: 'passivity'
                    },
                    states: {
                        prompt: {
                            entry: [
                                maybeAlternatives,
                                send((context: SDSContext) => ({
                                    type: "SPEAK", value: context.tdmUtterance
                                }))],
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
                            entry: send('LISTEN')
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
                                actions: tdmAssign,
                                cond: (_ctx, event) => event.data.output
                            },
                            {
                                target: 'fail'
                            }
                        ],
                        onError: { target: 'fail' }
                    }
                },
                nextHaptic: {
                    invoke: {
                        id: "hapticInput",
                        src: (context, _evt) => tdmRequest(hapticInput(context.sessionId, context.hapticInput)),
                        onDone: [
                            {
                                target: 'utter',
                                actions: tdmAssign,
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
                                actions: tdmAssign,
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
