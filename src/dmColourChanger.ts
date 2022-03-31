import { MachineConfig, send, Action } from "xstate";


const sayColour: Action<SDSContext, SDSEvent> = send((context: SDSContext) => ({
    type: "SPEAK", value: `Repainting to ${context.recResult[0].utterance}`
}))

function say(text: string): Action<SDSContext, SDSEvent> {
    return send((_context: SDSContext) => ({ type: "SPEAK", value: text }))
}

const svDict: { [index: string]: string } = {
    'garlic': 'vitlök',
    'onion': 'lök',
    'bread': 'bröd',
    'cheese': 'ost',
    'milk': 'mjölk'
}

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
    initial: 'idle',
    states: {
        idle: {
            on: {
                CLICK: 'init'
            }
        },
        init: {
            on: {
                TTS_READY: 'welcome',
                CLICK: 'welcome'
            }
        },

        welcome: {
            initial: 'prompt',
            on: {
                RECOGNISED: [
                    { target: 'stop', cond: (context) => context.recResult[0].utterance === 'Stop.' },
                    { target: 'helpWord', cond: (context) => context.recResultL2[0].utterance.includes("I say") },
                    { target: 'repaint' }],
                TIMEOUT: '..',
            },
            states: {
                prompt: {
                    entry: say("Vad har du på din inköpslista?"),
                    on: { ENDSPEECH: 'ask' }
                },
                ask: {
                    entry: send('LISTEN'),
                },
            }
        },
        helpWord: {
            initial: 'prompt',
            states: {
                prompt: {
                    entry: send((context: SDSContext) => ({
                        type: "SPEAK",
                        value: svDict[context.recResultL2[0].utterance.split(" ")[context.recResultL2[0].utterance.split(" ").length - 1].replace(/[?!]/, "")]
                    })),
                    on: { ENDSPEECH: 'ask' }
                },
                ask: {
                    entry: send('LISTEN'),
                    on: { RECOGNISED: 'yes' }
                },
                yes: {
                    entry: say("Exakt!"),
                    on: { ENDSPEECH: 'ask' }
                },
            }
        },
        stop: {
            entry: say("Ok"),
            always: 'init'
        },
        repaint: {
            initial: 'prompt',
            states: {
                prompt: {
                    entry: say("Javisst!"),
                    on: { ENDSPEECH: 'repaint' }
                },
                repaint: {
                    always: '#root.dm.welcome'
                }
            }
        }
    }
})
