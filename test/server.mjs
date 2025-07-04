"use strict";

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static("public"));

run().catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.json({ status: 200 });
});

async function run() {
  app.get("/sse/:streamId", (req, res) => {
    res.writeHead(200, {
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream",
    });
    res.flushHeaders();

    let counter = 0;
    let words = "";
    switch (req.params.streamId) {
      case "1":
        words =
          "Hello, |this |is |a |test |of stre|aming |messa|ges |one |by |one!| |[end]";
        break;
      case "2":
        words =
          "Hello, |this |is |a |<v>|test |of stre|aming |messa|ges |one |by |one!| |[end]";
        break;
      case "emptydone":
        words = "|[end]";
        break;
      case "onlydone":
        words = "[end]";
        break;
      case "noend":
        words = "Hello, |this |is |a";
        break;
    }
    const wordlist = words.split("|");
    const interval = setInterval(() => {
      if (wordlist[counter] !== undefined) {
        const chunk =
          wordlist[counter] === "<v>"
            ? `event: STREAMING_SET_VOICE\ndata:en-US-EmmaMultilingualNeural\n\n`
            : wordlist[counter] === "<l>"
              ? `event: STREAMING_SET_LOCALE\ndata:fr-FR\n\n`
              : wordlist[counter] !== "[end]"
                ? `event: STREAMING_CHUNK\ndata:${wordlist[counter]}\n\n`
                : `event: STREAMING_DONE\ndata:\n\n`;
        console.debug(`sent: <${chunk}>`);
        res.write(chunk);
        counter++;
      } else {
        clearInterval(interval);
      }
    }, 500);

    res.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  });

  app.listen(3000, () => {
    console.log(`SSE server listening on port ${3000}`);
  });
}
