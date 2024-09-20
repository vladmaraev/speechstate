import { createActor, createMachine, waitFor } from "xstate";
import { describe, test, expect } from "vitest";
import {
  AzureLanguageCredentials,
  AzureSpeechCredentials,
  Settings,
} from "../src/types";
import { speechstate } from "../src/speechstate";
import { AZURE_KEY } from "../src/credentials";
import { getView } from "./helpers";

describe("Basic initialisation tests", () => {
  test.todo("Fail ASR because azureAuthorizationToken is an erroneous object.");

  test("Spawn ASR and TTS resources. Fail, because the credentials are not provided.", async () => {
    const invalidCredentials: AzureSpeechCredentials = {
      endpoint:
        "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
      key: "",
    };
    const testMachine = createMachine({
      context: ({ spawn }) => {
        return {
          ssRef: spawn(speechstate, {
            input: {
              azureRegion: "northeurope",
              azureCredentials: invalidCredentials,
            },
          }),
        };
      },
    });

    const actor = createActor(testMachine).start();
    actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });
    const snapshot = await waitFor(
      actor.getSnapshot().context.ssRef,
      (snapshot) => {
        return getView(snapshot) === "error";
      },
      {
        timeout: 2000 /** allowed time to transition to the expected state */,
      },
    );
    expect(snapshot).toBeTruthy();
  });

  test("Spawn ASR and TTS resources. Reach Ready state.", async () => {
    const validCredentials: AzureSpeechCredentials = {
      endpoint:
        "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
      key: AZURE_KEY,
    };
    const testMachine = createMachine({
      context: ({ spawn }) => {
        return {
          ssRef: spawn(speechstate, {
            input: {
              azureRegion: "northeurope",
              azureCredentials: validCredentials,
            },
          }),
        };
      },
    });

    const actor = createActor(testMachine).start();
    actor.getSnapshot().context.ssRef.send({ type: "PREPARE" });
    const snapshot = await waitFor(
      actor.getSnapshot().context.ssRef,
      (snapshot) => {
        return getView(snapshot) === "idle";
      },
      {
        timeout: 3000 /** allowed time to transition to the expected state */,
      },
    );
    expect(snapshot).toBeTruthy();
  });
});
