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

        gui: {
            initial: 'micOnly',
            states: {
                micOnly: {
                    on: { SHOW_ALTERNATIVES: 'showAlternatives' },
                },
                showAlternatives: {
                    on: { SELECT: 'micOnly' },
                }
            }
        },

        asrtts: {
            initial: 'init',
            states: {
                init: {
                    on: {
                        CLICK: {
                            target: 'getToken',
                            actions: [
                                assign({
                                    audioCtx: (_ctx) =>
                                        new ((window as any).AudioContext || (window as any).webkitAudioContext)()
                                }),
                                (context) =>
                                    navigator.mediaDevices.getUserMedia({ audio: true })
                                        .then(function(stream) { context.audioCtx.createMediaStreamSource(stream) })
                            ]
                        }
                    }
                },
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
                                audioContext: context.audioCtx,
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
                    on: {
                        RECOGNISED: 'idle',
                        SELECT: 'idle',
                        CLICK: '.pause'
                    },
                    states: {
                        noinput: {
                            entry: [
                                'recStart',
                                send(
                                    { type: 'TIMEOUT' },
                                    { delay: (context) => (1000 * (context.tdmPassivity || defaultPassivity)), id: 'timeout' }
                                )],
                            on: {
                                TIMEOUT: '#root.asrtts.idle',
                                STARTSPEECH: 'inprogress'
                            },
                            exit: cancel('timeout')
                        },
                        inprogress: {
                            on: {
                                ASRRESULT: {
                                    actions: ['recLogResult',
                                        assign((_context, event) => {
                                            return {
                                                recResult: event.value
                                            }
                                        })],
                                    target: 'match'
                                },
                            }
                        },
                        match: {
                            on: {
                                ASRRESULT_L2: {
                                    actions: ['recLogResultL2',
                                        assign((_context, event) => {
                                            return {
                                                recResultL2: event.value
                                            }
                                        })],
                                    target: 'matchmatch'
                                },
                            },
                            exit: 'recStop',
                        },
                        matchmatch: {
                            entry: send('RECOGNISED'),
                        },
                        pause: {
                            entry: 'recStop',
                            on: { CLICK: 'noinput' }
                        }
                    }
                },
                speaking: {
                    entry: 'ttsStart',
                    on: {
                        ENDSPEECH: 'idle',
                        SELECT: 'idle',
                        CLICK: { target: 'idle', actions: send('ENDSPEECH') }
                    },
                    exit: 'ttsStop',
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
                console.log('U>', context.recResult[0]["utterance"], context.recResult[0]["confidence"]);
            },
            recLogResultL2: (context: SDSContext) => {
                /* context.recResult = event.recResult; */
                console.log('U>', context.recResultL2[0]["utterance"], context.recResultL2[0]["confidence"]);
            },
            logIntent: (context: SDSContext) => {
                /* context.nluData = event.data */
                console.log('<< NLU intent: ' + context.nluData.intent.name)
            }
        },
    });



interface Props extends React.HTMLAttributes<HTMLElement> {
    state: State<SDSContext, any, any, any>;
    alternative: any;
}
const ReactiveButton = (props: Props): JSX.Element => {
    var promptText = ((props.state.context.tdmVisualOutputInfo || [{}])
        .find((el: any) => el.attribute === "name") || {}).value;
    var promptImage = ((props.state.context.tdmVisualOutputInfo || [{}])
        .find((el: any) => el.attribute === "image") || {}).value;
    var circleClass = "circle"
    switch (true) {
        case props.state.matches({ asrtts: 'fail' }) || props.state.matches({ dm: 'fail' }):
            break;
        case props.state.matches({ asrtts: { recognising: 'pause' } }):
            promptText = "Click to continue"
            break;
        case props.state.matches({ asrtts: 'recognising' }):
            circleClass = "circle-recognising"
            promptText = promptText || 'Listening...'
            break;
        case props.state.matches({ asrtts: 'speaking' }):
            circleClass = "circle-speaking"
            promptText = promptText || 'Speaking...'
            break;
        case props.state.matches({ dm: 'idle' }):
            promptText = ""
            circleClass = "circle-click"
            break;
        case props.state.matches({ dm: 'init' }):
            promptText = ""
            circleClass = "circle-click"
            break;
        default:
            promptText = promptText || '\u00A0'
    }
    return (
        <div className="control">
            <figure className="prompt">
                {promptImage &&
                    <img src={promptImage}
                        alt={promptText} />}
            </figure>
            <div className="status">
                <button type="button" className={circleClass}
                    style={{}} {...props}>
                </button>
                <div className="status-text">
                    {promptText}
                </div>
            </div>
        </div>);
}

const FigureButton = (props: Props): JSX.Element => {
    const caption = props.alternative.find((el: any) => el.attribute === "name").value
    const imageSrc = (props.alternative.find((el: any) => el.attribute === "image") || {}).value
    return (
        <figure className="flex" {...props}>
            {imageSrc &&
                <img src={imageSrc} alt={caption} />}
            <figcaption>{caption}</figcaption>
        </figure>
    )
}

function App() {
    const [current, send] = useMachine(machine, {
        devTools: true,
        actions: {
            recStart: asEffect((context) => {
                context.asr.start()
                context.asrL2.start()
                /* console.log('Ready to receive a voice input.'); */
            }),
            recStop: asEffect((context) => {
                context.asr.abort()
                context.asrL2.abort()
                /* console.log('Recognition stopped.'); */
            }),
            ttsStart: asEffect((context) => {
                let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="sv-SE"><voice name="${context.voice.name}">`
                content = content + (process.env.REACT_APP_TTS_LEXICON ? `<lexicon uri="${process.env.REACT_APP_TTS_LEXICON}"/>` : "")
                content = content + `${context.ttsAgenda}</voice></speak>`
                const utterance = new context.ttsUtterance(content);
                console.log("S>", context.ttsAgenda, content)
                utterance.voice = context.voice
                utterance.onend = () => send('ENDSPEECH')
                context.tts.speak(utterance)
            }),
            ttsStop: asEffect((context) => {
                /* console.log('TTS STOP...'); */
                context.tts.cancel()
            }),
            ponyfillASR: asEffect((context, _event) => {
                const
                    { SpeechRecognition }
                        = createSpeechRecognitionPonyfill({
                            audioContext: context.audioCtx,
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

                context.asrL2 = new SpeechRecognition()
                context.asrL2.lang = 'en-US'
                context.asrL2.continuous = true
                context.asrL2.interimResults = true
                context.asrL2.onresult = function(event: any) {
                    var result = event.results[0]
                    if (result.isFinal) {
                        send({
                            type: "ASRRESULT_L2", value:
                                [{
                                    "utterance": result[0].transcript,
                                    "confidence": result[0].confidence
                                }]
                        })
                    }
                }

            })
        }
    });
    const figureButtons = (current.context.tdmExpectedAlternatives || []).filter((o: any) => o.visual_information)
        .map(
            (o: any, i: any) => (
                <FigureButton state={current}
                    alternative={o.visual_information}
                    key={i}
                    onClick={() => send({ type: 'SELECT', value: o.semantic_expression })} />
            )
        )

    switch (true) {
        default:
            return (
                <div className="App">
                    <ReactiveButton state={current} alternative={{}} onClick={() => send('CLICK')} />
                    <div className="select-wrapper">
                        <div className="select">
                            {figureButtons}
                        </div>
                    </div>
                </div>
            )
    }

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
