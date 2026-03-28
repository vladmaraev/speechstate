---
title: "Events"
---
## Sequence diagram
![](../../assets/images/dm-speechstate.svg)

## Parameters
### `Agenda`
| Parameter     | Type                  | Required   | Explanation                 | Default |
|---------------|-----------------------|------------|-----------------------------|---------|
| `utternance`  | `string`              | ✔️          | SSML tags are supported [^1] |         |
| `bargeIn`     | `RecogniseParameters` |            |                             |         |
| `locale`      | `string`              |            |                             |         |
| `voice`       | `string`              |            |                             |         |
| `stream`      | `string`              |            |                             |         |
| `cache`       | `string`              |            |                             |         |
| `fillerDelay` | `number`              |            |                             |         |
| `audioURL`    | `string`              |            |                             |         |
| `visemes`     | `boolean`             | DEPRECATED |                             |         |
    
[^1]: TODO.

## Events
### `SPEAK`


### `LISTEN`
