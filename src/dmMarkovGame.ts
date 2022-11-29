import { MachineConfig, send, assign, Action } from "xstate";

function say(text: string): Action<SDSContext, SDSEvent> {
  return send((_context: SDSContext) => ({ type: "SPEAK", value: text }));
}

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = {
  initial: "idle",
  states: {
    idle: {
      entry: assign({ winCount: 0, gameCount: 0 }),
      on: {
        CLICK: "init",
      },
    },
    init: {
      on: {
        TTS_READY: "welcome",
        CLICK: "welcome",
      },
    },
    welcome: {
      initial: "prompt",
      on: {
        RECOGNISED: [
          {
            target: "decide.purple",
            cond: (context) =>
              context.recResult[0].utterance.toLowerCase().includes("purple"),
          },
          {
            target: "decide.orange",
            cond: (context) =>
              context.recResult[0].utterance.toLowerCase().includes("orange"),
          },
          { target: ".nomatch" },
        ],
      },
      states: {
        prompt: {
          entry: say("Purple flower or orange flower?"),
          on: { ENDSPEECH: "ask" },
        },
        nomatch: {
          entry: say("Sorry, I didn't understand."),
          on: { ENDSPEECH: "prompt" },
        },
        ask: {
          entry: send("LISTEN"),
        },
      },
    },
    decide: {
      states: {
        purple: {
          always: [
            { target: "#root.dm.win", cond: { type: "prob", threshold: 0.2 } },
            { target: "#root.dm.lose" },
          ],
        },
        orange: {
          always: [
            { target: "#root.dm.win", cond: { type: "prob", threshold: 0.5 } },
            { target: "#root.dm.lose" },
          ],
        },
      },
    },
    win: {
      entry: [
        say("You won!"),
        assign({
          winCount: (context) => context.winCount + 1,
          gameCount: (context) => context.gameCount + 1,
        }),
      ],
      on: { ENDSPEECH: "score" },
    },
    lose: {
      entry: [
        say("You lost!"),
        assign({ gameCount: (context) => context.gameCount + 1 }),
      ],
      on: { ENDSPEECH: "score" },
    },
    score: {
      entry: send((context: SDSContext) => ({
        type: "SPEAK",
        value: `In total you won ${context.winCount} out of ${context.gameCount}. Let's play again!`,
      })),
      on: { ENDSPEECH: "welcome" },
    },
  },
};
