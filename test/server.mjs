"use strict";

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static('public'))

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
      case "noend":
        words = "Hello, |this |is |a";
        break;
    }
    words = words.split("|");
    const interval = setInterval(() => {
      if (words[counter]) {
        const chunk =
          words[counter] === "<v>"
            ? `event: STREAMING_SET_VOICE\ndata:en-US-EmmaMultilingualNeural\n\n`
            : words[counter] !== "[end]"
              ? `event: STREAMING_CHUNK\ndata:${words[counter]}\n\n`
              : `event: STREAMING_DONE\ndata:\n\n`;
        res.write(chunk);
        counter++;
      } else {
        clearInterval(interval);
      }
    }, 300);

    res.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  });

  app.listen(3000, () => {
    console.log(`SSE server listening on port ${3000}`);
  });
}
