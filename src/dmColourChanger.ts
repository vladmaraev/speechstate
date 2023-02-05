import { MachineConfig, send, assign } from "xstate";

export const dmMachine: MachineConfig<DomainContext, any, SDSEvent> = {
  predictableActionArguments: true,
  initial: "pre",
  states: {
    pre: {
      on: {
        PREPARE: "init",
      },
    },
    init: {
      on: {
        CLICK: { target: "welcome", in: "#sds.asrtts.ready" },
      },
    },
    welcome: {
      initial: "prompt",
      on: {
        RECOGNISED: [
          {
            target: "stop",
            actions: (_c, e) => console.log(e),
            cond: (_c, e) => e.value[0].utterance === "Stop",
          },
          {
            target: "repaint",
            actions: assign({
              colour: (_c, e) =>
                e.value[0].utterance.toLowerCase().replace(/[\W_]+/g, ""),
            }),
          },
        ],
        ASR_NOINPUT_TIMEOUT: "..",
      },
      states: {
        prompt: {
          entry: send({ type: "SPEAK", value: "Tell me the colour" }),
          on: { ENDSPEECH: "ask" },
        },
        ask: {
          entry: send("LISTEN"),
        },
      },
    },
    stop: {
      entry: send({ type: "SPEAK", value: "Ok." }),
      always: "init",
    },
    repaint: {
      initial: "prompt",
      states: {
        prompt: {
          entry: send((c: DomainContext) => ({
            type: "SPEAK",
            value: `Attempting to repaint to ${c.colour}`,
          })),
          on: { ENDSPEECH: "repaint" },
        },
        repaint: {
          entry: "changeColour",
          always: "#sds.dm.init",
        },
      },
    },
  },
};
