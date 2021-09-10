import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { inspect } from "@xstate/inspect";
import { tdmDmMachine } from "./tdmClient";
import { jaicpDmMachine } from "./jaicpClient";
import { dmMachine } from "./dmColourChanger";

import createSpeechRecognitionPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText'
import createSpeechSynthesisPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/TextToSpeech';

let dm = dmMachine
if (process.env.REACT_APP_BACKEND === 'TDM') {
    dm = tdmDmMachine
} else if (process.env.REACT_APP_BACKEND === 'JAICP') {
    dm = jaicpDmMachine
}

const { send, cancel } = actions

const TOKEN_ENDPOINT = 'https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken';
const REGION = 'northeurope';

inspect({
    url: "https://statecharts.io/inspect",
    iframe: false
});


const defaultPassivity = 10

const machine = Machine<SDSContext, any, SDSEvent>({
    id: 'root',
    type: 'parallel',
    states: {
        dm: {
            ...dm
        },
        asrtts: {
            initial: 'getToken',
            states: {
                getToken: {
                    invoke: {
                        id: "getAuthorizationToken",
                        src: (_ctx, _evt) => getAuthorizationToken(),
                        onDone: {
                            actions: [
                                assign((_context, event) => { return { azureAuthorizationToken: event.data } }),
                                'ponyfillASR'],
                            target: 'ponyfillTTS'
                        },
                        onError: {
                            target: 'fail'
                        }
                    }
                },
                ponyfillTTS: {
                    invoke: {
                        id: 'ponyTTS',
                        src: (context, _event) => (callback, _onReceive) => {
                            const ponyfill = createSpeechSynthesisPonyfill({
                                credentials: {
                                    region: REGION,
                                    authorizationToken: context.azureAuthorizationToken,
                                }
                            });
                            const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
                            context.tts = speechSynthesis
                            context.ttsUtterance = SpeechSynthesisUtterance
                            context.tts.addEventListener('voiceschanged', () => {
                                context.tts.cancel()
                                const voices = context.tts.getVoices();
                                let voiceRe = RegExp("en-US", 'u')
                                if (process.env.REACT_APP_TTS_VOICE) {
                                    voiceRe = RegExp(process.env.REACT_APP_TTS_VOICE, 'u')
                                }
                                const voice = voices.find((v: any) => voiceRe.test(v.name))!
                                if (voice) {
                                    context.voice = voice
                                    callback('TTS_READY')
                                } else {
                                    console.error(`TTS_ERROR: Could not get voice for regexp ${voiceRe}`)
                                    callback('TTS_ERROR')
                                }
                            })
                        }
                    },
                    on: {
                        TTS_READY: 'idle',
                        TTS_ERROR: 'fail'
                    }
                },
                idle: {
                    on: {
                        LISTEN: 'recognising',
                        SPEAK: {
                            target: 'speaking',
                            actions: assign((_context, event) => { return { ttsAgenda: event.value } })
                        }
                    },
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
                },
                fail: {}
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
        case props.state.matches({ asrtts: 'fail' }) || props.state.matches({ dm: 'fail' }):
            return (
                <div className="control">
                    <div className="status">Something went wrong...</div>
                    <button type="button" className="circle"
                        style={{}} {...props}>
                    </button>
                </div>);
        case props.state.matches({ asrtts: 'recognising' }):
            return (
                <div className="control">
                    <div className="status-talk">talk</div>
                    <button type="button" className="circle"
                        style={{ animation: "bordersize 2s infinite" }} {...props}>
                    </button>
                </div>
            );
        case props.state.matches({ asrtts: 'speaking' }):
            return (
                <div className="control">
                    <div className="status">speaking</div>
                    <button type="button" className="circle-speaking"
                        style={{ animation: "bordering 2s infinite" }} {...props}>
                    </button>
                </div>
            );

        case props.state.matches({ dm: 'init' }):
            return (
                <div className="control" {...props}>
                    <div className="status-talk">click to start!</div>
                    <button type="button" className="circle-click"
                        style={{}}>
                    </button>
                </div>
            );

        default:
            return (
                <div className="control">
                    <div className="status-talk"></div>
                    <button type="button" className="circle"
                        style={{}} {...props}>
                    </button>
                </div>
            );
    }
}


function App() {
    const [current, send] = useMachine(machine, {
        devTools: true,
        actions: {
            recStart: asEffect((context) => {
                console.log('Ready to receive a voice input.');
                context.asr.start()
            }),
            recStop: asEffect((context) => {
                console.log('Recognition stopped.');
                context.asr.abort()
            }),
            ttsStart: asEffect((context) => {
                const utterance = new context.ttsUtterance(context.ttsAgenda);
                utterance.voice = context.voice
                utterance.onend = () => send('ENDSPEECH')
                context.tts.speak(utterance)
            }),
            ttsCancel: asEffect(() => {
                console.log('TTS STOP...');
                /* cancel() */
                speechSynthesis.cancel()
            }),
            ponyfillASR: asEffect((context, _event) => {
                const
                    { SpeechRecognition }
                        = createSpeechRecognitionPonyfill({
                            credentials: {
                                region: REGION,
                                authorizationToken: context.azureAuthorizationToken,
                            }
                        });
                context.asr = new SpeechRecognition()
                context.asr.lang = process.env.REACT_APP_ASR_LANGUAGE || 'en-US'
                context.asr.continuous = true
                context.asr.interimResults = true
                context.asr.onresult = function(event: any) {
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

            })
        }
    });


    return (
        <div className="App">
            <ReactiveButton state={current} onClick={() => send('CLICK')} />
        </div>
    )
};

const getAuthorizationToken = () => (
    fetch(new Request(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': process.env.REACT_APP_SUBSCRIPTION_KEY!
        },
    })).then(data => data.text()))


const rootElement = document.getElementById("root");
ReactDOM.render(
    <App />,
    rootElement);
