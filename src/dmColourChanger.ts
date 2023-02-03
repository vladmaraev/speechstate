import { MachineConfig, send, Action } from "xstate";

const sayColour: Action<SDSContext, SDSEvent> = send((context: SDSContext) => ({
  type: "SPEAK",
  value: `Repainting to ${context.recResult[0].utterance}`,
}));

function say(text: string): Action<SDSContext, SDSEvent> {
  return send((_context: SDSContext) => ({ type: "SPEAK", value: text }));
}

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
      initial: "prompt",
      on: {
        RECOGNISED: [
          {
            target: "stop",
            cond: (context) => context.recResult[0].utterance === "Stop.",
          },
          { target: "repaint" },
        ],
        TIMEOUT: "..",
      },
      states: {
        hist: { type: "history" },
        prompt: {
          entry: say("What would you like to have?"),
          on: { ENDSPEECH: "ask" },
        },
        ask: {
          entry: send("LISTEN"),
        },
      },
    },
    stop: {
      entry: say("Ok"),
      always: "init",
    },
    repaint: {
      initial: "prompt",
      states: {
        prompt: {
          entry: say("Sure! Anything else?"),
          on: { ENDSPEECH: "#root.dm.welcome.hist" },
        },
        // repaint: {
        //   entry: "changeColour",
        //   always: "#root.dm.welcome",
        // },
      },
    },
  },
};
