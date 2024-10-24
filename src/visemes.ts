import { setup, assign, fromPromise, sendParent, stopChild } from "xstate";
import { Frame, Animation } from "./types";

const blendShapeToFrameParams = (blendShapes: number[]) => {
  return blendShapes.reduce(
    (a, v, i) => ({ ...a, [blendShapeMap[i + 1]]: v }),
    {},
  );
};

/** @deprecated left here only for reference */
const visemeMap: { [key: string]: any } = {
  // Silence
  0: { MOUSE_CLOSE: 0, JAW_OPEN: 0 },
  // æ, ə, ʌ
  1: { PHONE_AAH: 1 },
  // ɑ
  2: { PHONE_AAH: 1 },
  // ɔ
  3: { PHONE_OOH: 1 },
  // ɛ, ʊ
  4: { PHONE_EE: 1 },
  // ɝ
  5: { PHONE_EE: 1 },
  // j, i, ɪ
  6: { PHONE_I: 1 },
  // w, u
  7: { PHONE_U: 1 },
  // o
  8: { PHONE_OOH: 1 },
  // aʊ
  9: { PHONE_AAH: 1 },
  // ɔɪ
  10: { PHONE_OOH: 1 },
  // aɪ
  11: { PHONE_AAH: 1 },
  // h
  12: { PHONE_AAH: 1 },
  // ɹ
  13: { PHONE_R: 1 },
  // l
  14: { PHONE_TH: 1 },
  // s, z
  15: { PHONE_D_S_T: 1 },
  // ʃ, tʃ, dʒ, ʒ
  16: { PHONE_CH_J_SH: 1 },
  // ð
  17: { PHONE_TH: 1 },
  // f, v
  18: { PHONE_F_V: 1 },
  // d, t, n, θ
  19: { PHONE_D_S_T: 1 },
  //  k, g, ŋ
  20: { PHONE_K: 1 },
  // p, b, m
  21: { PHONE_B_M_P: 1 },
};

const animationToFrames = (animation: Animation): Frame[] => {
  const frames = animation.BlendShapes.map((x, i) => {
    return {
      time: [
        i / 60, // 60 FPS
      ],
      params: blendShapeToFrameParams(x),
    };
  });
  return [...frames];
};

const blendShapeMap = {
  1: "EYE_BLINK_LEFT",
  2: "EYE_LOOK_DOWN_LEFT",
  3: "EYE_LOOK_IN_LEFT",
  4: "EYE_LOOK_OUT_LEFT",
  5: "EYE_LOOK_UP_LEFT",
  6: "EYE_SQUINT_LEFT",
  7: "EYE_WIDE_LEFT",
  8: "EYE_BLINK_RIGHT",
  9: "EYE_LOOK_DOWN_RIGHT",
  10: "EYE_LOOK_IN_RIGHT",
  11: "EYE_LOOK_OUT_RIGHT",
  12: "EYE_LOOK_UP_RIGHT",
  13: "EYE_SQUINT_RIGHT",
  14: "EYE_WIDE_RIGHT",
  15: "JAW_FORWARD",
  16: "JAW_LEFT",
  17: "JAW_RIGHT",
  18: "JAW_OPEN",
  19: "MOUTH_CLOSE",
  20: "MOUTH_FUNNEL",
  21: "MOUTH_PUCKER",
  22: "MOUTH_LEFT",
  23: "MOUTH_RIGHT",
  24: "MOUTH_SMILE_LEFT",
  25: "MOUTH_SMILE_RIGHT",
  26: "MOUTH_FROWN_LEFT",
  27: "MOUTH_FROWN_RIGHT",
  28: "MOUTH_DIMPLE_LEFT",
  29: "MOUTH_DIMPLE_RIGHT",
  30: "MOUTH_STRETCH_LEFT",
  31: "MOUTH_STRETCH_RIGHT",
  32: "MOUTH_ROLL_LOWER",
  33: "MOUTH_ROLL_UPPER",
  34: "MOUTH_SHRUG_LOWER",
  35: "MOUTH_SHRUG_UPPER",
  36: "MOUTH_PRESS_LEFT",
  37: "MOUTH_PRESS_RIGHT",
  38: "MOUTH_LOWER_DOWN_LEFT",
  39: "MOUTH_LOWER_DOWN_RIGHT",
  40: "MOUTH_UPPER_UP_LEFT",
  41: "MOUTH_UPPER_UP_RIGHT",
  42: "BROW_DOWN_LEFT",
  43: "BROW_DOWN_RIGHT",
  44: "BROW_INNER_UP",
  45: "BROW_OUTER_UP_LEFT",
  46: "BROW_OUTER_UP_RIGHT",
  47: "CHEEK_PUFF",
  48: "CHEEK_SQUINT_LEFT",
  49: "CHEEK_SQUINT_RIGHT",
  50: "NOSE_SNEER_LEFT",
  51: "NOSE_SNEER_RIGHT",
  52: "TONGUE_OUT",
  53: "HEAD_ROLL",
  54: "LEFT_EYE_ROLL",
  55: "RIGHT_EYE_ROLL",
};

export const visemesMachine = setup({
  types: {} as {
    context: { queue: number[] };
    events: { type: "VISEME"; value: any };
  },
}).createMachine({
  context: { queue: [] },
  initial: "Init",
  states: {
    Init: {
      on: {
        VISEME: [
          {
            guard: ({ event }) => !!event.value.animation,
            actions: [
              sendParent(
                ({ event }) => ({
                  type: "FURHAT_BLENDSHAPES",
                  value: animationToFrames(JSON.parse(event.value.animation)),
                }),
                {
                  delay: ({ event }) =>
                    (JSON.parse(event.value.animation).FrameIndex * 1000) / 60,
                },
              ),
            ],
          },
        ],
      },
    },
  },
});
