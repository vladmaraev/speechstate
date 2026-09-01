import { fromPromise } from "xstate";
import {
  AzureSpeechCredentials,
  AzureSpeechTokenProxyCredentials,
} from "./types";

export const getToken = fromPromise(
  async ({
    input,
  }: {
    input: {
      credentials:
        | AzureSpeechTokenProxyCredentials
        | AzureSpeechCredentials
        | string;
    };
  }) => {
    if (typeof input.credentials === "string") {
      return fetch(new Request(input.credentials)).then((data) => data.text());
    } else {
      if ("proxyUrl" in input.credentials) {
        return fetch(
          new Request(
            input.credentials.proxyUrl,
            input.credentials.key && {
              headers: { Authorization: `Bearer ${input.credentials.key}` },
            },
          ),
        ).then((data) => data.text());
      } else {
        return fetch(
          new Request(input.credentials.endpoint, {
            method: "POST",
            headers: {
              "Ocp-Apim-Subscription-Key": input.credentials.key,
            },
          }),
        ).then((data) => data.text());
      }
    }
  },
);
