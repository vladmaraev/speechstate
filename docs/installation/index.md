---
title: "Getting Started"
---
## Installation


```bash
npm install speechstate
```

## Global Settings
::: callout tip "XState docs"
- [Input](https://stately.ai/docs/input "XState docs")
:::
Global settings are provided to `speechstate` state machine as input.


### Settings
| Parameter                | Type                               | Explanation                                                      | Default               |
|--------------------------|------------------------------------|------------------------------------------------------------------|-----------------------|
| bargeIn                  | `false \| RecogniseParameters`     | [Barge-in](../tts/#speech-synthesis-tts-barge-in)                |                       |
| locale                   | `string`                           | Default locale, used both by ASR, TTS and NLU                    | `"en-US"`             |
| noPonyfill               | `boolean`                          | If `true`, disables ponyfilling of ASR and TTS                    |                       |
| azureCredentials         | `string \| AzureSpeechCredentials` | [see below](#getting-started-global-settings-speech-credentials) |                       |
| azureRegion              | string;                            | The region where Azure Speech resource is deployed               |                       |
| azureLanguageCredentials | AzureLanguageCredentials;          | [see below](#getting-started-global-settings-speech-credentials) |                       |
| newTokenInterval         | number;                            | Interval after which the new token is retrieved                  | `300_000` (5 minutes) |

Speech recognition and synthesis settings can be also defined here. See [ASR](../asr) and [TTS](../tts).

#### Example 

```typescript
const azureCredentials = {
  endpoint:
    "https://swedencentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: "<KEY>",
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "swedencentral",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

```
    
### Azure Speech Credentials

Azure speech credentials are used to retrieve tokens for speech recognition and synthesis. The interval of token retrieval is specified by `newTokenInterval` parameter.

Credentials for [Azure Speech](https://azure.microsoft.com/en-us/products/ai-foundry/tools/speech/) are required for ponyfilling [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).

You can find the values for the following parameters in your **Speech service** resource in **Azure Portal** (**Keys and Endpoints**).

| Parameter  | Type     |
|------------|----------|
| `endpoint` | `string` |
| `key`      | `string` |

::: callout info
Do not forget to set `azureRegion` parameter. 
:::

::: callout warning "Do not expose your keys in production!"
When setting up `azureCredentials` you can set provide a URL as a string. In this case this URL will be used for retrieving the token. 
:::



### Azure Language Credentials
| Parameter        | Type (? - optional) | Explanation | Default |
|------------------|---------------------|-------------|---------|
| `endpoint`       | `string`            |             |         |
| `key`            | `string`            |             |         |
| `projectName`    | `string`            |             |         |
| `deploymentName` | `string`            |             |         |


## Spawn SpeechState

::: callout tip "XState docs"
- [Spawn](https://stately.ai/docs/actor-model#spawning)
:::


```typescript
  import { speechstate } from "speechstate";

  // define your the context of your statechart as follows
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
  }),
```
