import { MachineConfig, send, assign } from "xstate";

const jaicpToken = 'NRBTzSQe:69ae9a334ee112ff9a006af3639ed243ec38e431'
const jaicpEndpoint = "https://bot.jaicp.com/chatapi/" + jaicpToken

const ID = function() {
    // Math.random should be unique because of its seeding algorithm.
    // Convert it to base 36 (numbers + letters), and grab the first 9 characters
    // after the decimal. from https://gist.github.com/gordonbrander/2230317
    return '_' + Math.random().toString(36).substr(2, 9);
};

const sessionID = ID()

const jaicpRequest = (query: string) => (fetch(new Request(jaicpEndpoint, {
    method: 'POST',
    headers: {
        'Content-type': 'application/json'
    },
    body: JSON.stringify({
        "clientId": "speechstate_" + sessionID,
        "query": query,
    })
})).then(data => data.json()))


export const jaicpDmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
    initial: 'init',
    states: {
        init: {
            entry: assign({
                ttsAgenda: (_ctx, event) => "Привет! Спроси меня что-нибудь."
            }),
            on: {
                CLICK: 'jaicp'
            }
        },
        jaicp: {
            initial: 'utter',
            states: {
                utter: {
                    initial: 'prompt',
                    states: {
                        prompt: {
                            entry: send((context: SDSContext) => ({
                                type: "SPEAK", value: context.ttsAgenda
                            })),
                            on: { ENDSPEECH: 'ask' },
                        },
                        ask: {
                            entry: send('LISTEN')
                        },
                    },
                    on: {
                        RECOGNISED: 'next',
                        // TIMEOUT: 'passivity'
                    },
                },
                next: {
                    invoke: {
                        id: "nlInput",
                        src: (context, _evt) => jaicpRequest(context.recResult[0].utterance),
                        onDone: [
                            {
                                target: 'utter',
                                actions:
                                    assign({
                                        ttsAgenda: (_ctx, event) => event.data.data.answer,
                                    }),
                                cond: (_ctx, event) => event.data.data.answer !== ""
                            },
                            {
                                target: '#root.dm.fail'
                            }
                        ],
                        onError: { target: '#root.dm.fail' }
                    }

                },
            },
        },
        fail: {}
    },
});
