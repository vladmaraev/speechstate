import { AnyActor, waitFor } from "xstate";

export function getView(snapshot: any): string | undefined {
  const metaTS: { view?: string } = Object.values(snapshot.getMeta())[0] || {
    view: undefined,
  };
  return metaTS.view;
}

export function waitForView(
  actor: AnyActor,
  view: string,
  timeout: number = 1000,
) {
  return waitFor(
    actor.getSnapshot().context.ssRef,
    (snapshot) => {
      return getView(snapshot) === view;
    },
    {
      timeout: timeout /** allowed time to transition to the expected state */,
    },
  );
}

export const pause = (t: number) =>
  new Promise((resolve) =>
    setTimeout(() => {
      resolve("ok");
    }, t),
  );
