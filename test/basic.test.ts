import { interpret } from "xstate";
import { ttsMachine } from "../src/tts";

it("doesn't proceed without Azure credentials", (done) => {
  const myTtsMachine = interpret(ttsMachine, {
    input: {},
  });

  myTtsMachine.subscribe((state) => {
    console.log(state.value);
    if (state.matches("fail")) {
      done();
    }
  });

  myTtsMachine.start();
});
