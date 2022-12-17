import { createMachine, MachineConfig, send, assign, Action } from "xstate";

function say(text: string): Action<SDSContext, SDSEvent> {
  return send((_context: SDSContext) => ({ type: "SPEAK", value: text }));
}

interface MDPContext {
  reward: number;
}

const additionMDP: MachineConfig<SDSContext, any, SDSEvent> = {
  id: "additionMDP",
  initial: "start",
  states: {
    start: {
      on: {
        U: {
          target: "s2",
          actions: assign((context: any) => {
            return { reward: context.reward + 4, lastReward: 4 };
          }),
        },
        R: {
          target: "s4",
          actions: assign((context: any) => {
            return { reward: context.reward + 10, lastReward: 10 };
          }),
        },
      },
    },
    s2: {
      on: {
        R: {
          target: "s3",
          actions: assign((context: any) => {
            return { reward: context.reward + 7, lastReward: 7 };
          }),
        },
      },
    },
    s3: {
      type: "final",
    },
    s4: {
      type: "final",
    },
  },
};

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = {
  initial: "idle",
  states: {
    idle: {
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
      entry: [
        say("Welcome! You can say left, right, up or down."),
        assign({ winCount: 0, gameCount: 0, reward: 0, lastReward: 0 }),
      ],
      on: { ENDSPEECH: "game" },
    },
    game: {
      type: "parallel",
      states: {
        control: {
          initial: "ask",
          on: {
            L: ".currentScore",
            R: ".currentScore",
            U: ".currentScore",
            D: ".currentScore",
            GAMEOVER: ".gameover",
            RECOGNISED: [
              {
                actions: send("L"),
                cond: (context) =>
                  context.recResult[0].utterance.toLowerCase().includes("left"),
              },
              {
                actions: send("R"),
                cond: (context) =>
                  context.recResult[0].utterance
                    .toLowerCase()
                    .includes("right"),
              },
              {
                actions: send("U"),
                cond: (context) =>
                  context.recResult[0].utterance.toLowerCase().includes("up"),
              },
              {
                actions: send("D"),
                cond: (context) =>
                  context.recResult[0].utterance.toLowerCase().includes("down"),
              },
              { target: ".nomatch" },
            ],
          },

          states: {
            ask: {
              entry: [say("Pick the direction"), assign({ lastReward: 0 })],
              on: { ENDSPEECH: "listen" },
            },
            currentScore: {
              entry: [
                send((context: SDSContext) => ({
                  type: "SPEAK",
                  value: `You got: ${context.lastReward} points.`,
                })),
              ],
              on: {
                ENDSPEECH: {
                  target: "ask",
                },
              },
            },
            nomatch: {
              entry: say("Please say: left, right, up or down."),
              on: { ENDSPEECH: "listen" },
            },
            listen: { entry: send("LISTEN") },
            gameover: { on: { ENDSPEECH: "#root.dm.score" } },
          },
        },
        mdp: { ...additionMDP, onDone: { actions: send("GAMEOVER") } },
      },
    },
    score: {
      entry: send((context: SDSContext) => ({
        type: "SPEAK",
        value: `The game is over. You total score in this game is ${context.reward}. Let's play again!`,
      })),
      on: { ENDSPEECH: "#root.dm.welcome" },
    },
  },
};

// var draw = SVG().addTo("#chart").move(500, 500).size(300, 300);
// var rect = draw.rect(100, 100).attr({ fill: "#f06" });
// var rect2 = draw.rect(800, 300).attr({ fill: "#f06" });
