import * as line from '@line/bot-sdk'
import express from 'express'

// create LINE SDK config from env variables
const config = {
  //channelSecret: process.env.CHANNEL_SECRET,
  channelSecret: '81c6115cd7ed12970258b493d4440f00',
};

// create LINE SDK client
const client = line.LineBotClient.fromChannelAccessToken({
  //channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
  channelAccessToken: 'u8kM4c+tMQUlJPBcJN5Gx4g0fP+VEcC4xA7clNdAmbVuUHp7PTVSHbr5RBONPoDgGJs/mx6KZC0gh9Gy4oi9wjbqgztvThVqGmvdseJbslyQS0QHH3BoVxb15f+kV7AE6fC8QRrO5/TFR8hbLDOTDQdB04t89/1O/w1cDnyilFU='
});

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/callback', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// event handler
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  // create an echoing text message
  const echo = { type: 'text', text: event.message.text };

  // use reply API
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [echo],
  });
}

// listen on port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});