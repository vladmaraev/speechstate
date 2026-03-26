---
title: "Installation"
---

## Installation

::: tabs

== tab "npm"
```bash
npm install xstate speechstate
```

== tab "yarn"
```bash
yarn add xstate speechstate
```

:::

## Global settings


## Spawn SpeechState
```typescript
  import { speechstate } from "speechstate";

  // define your the context of your statechart as follows
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
  }),
```
