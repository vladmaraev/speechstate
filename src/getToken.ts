import { fromPromise } from "xstate";

export const getToken = fromPromise(({ input }) => {
  if (typeof input.credentials === "string") {
    return fetch(new Request(input.credentials)).then((data) => data.text());
  } else {
    return fetch(
      new Request(input.credentials.endpoint, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": input.credentials.key,
        },
      })
    ).then((data) => data.text());
  }
});
