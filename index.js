import dotenv from 'dotenv';
import * as line from '@line/bot-sdk'
import express from 'express'

dotenv.config();

console.log('LINE_CHANNEL_ACCESS_TOKEN:', process.env.LINE_CHANNEL_ACCESS_TOKEN);
console.log('LINE_CHANNEL_SECRET:', process.env.LINE_CHANNEL_SECRET);

// create LINE SDK config from env variables
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

// create LINE SDK client for v11
const messagingApi = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// middleware to parse JSON body - but AFTER raw body for LINE
app.use(express.raw({type: 'application/json'}));

// health check endpoint
app.get('/callback', (req, res) => {
  console.log('GET /callback - Health check');
  res.status(200).send('OK');
});

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/callback', line.middleware(config), (req, res) => {
  try {
    console.log('Received webhook');
    
    // Parse body if it's a buffer (from raw middleware)
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = JSON.parse(body.toString());
      req.body = body;
    }
    
    console.log('Body:', JSON.stringify(body, null, 2));
    
    // Always respond with 200 OK immediately
    res.status(200).json({ message: 'ok' });
    
    // Process events asynchronously
    if (!body.events || body.events.length === 0) {
      console.log('No events to process');
      return;
    }
    
    for (const event of body.events) {
      try {
        handleEvent(event).catch(err => {
          console.error('Error handling individual event:', err);
        });
      } catch (error) {
        console.error('Error handling individual event:', error);
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
});

// event handler
function handleEvent(event) {
  console.log('Handling event:', event.type, event.message?.type);
  
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  // create an echoing text message
  const echo = { type: 'text', text: event.message.text };

  console.log('Sending reply:', echo);
  
  // use reply API
  return messagingApi.replyMessage({
    replyToken: event.replyToken,
    messages: [echo],
  });
}
app.get('/', (req, res) => {
  res.send('hello world, Natthawut');
});

// listen on port
const port = 3006;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Webhook URL should be: https://<your-ngrok-url>/callback`);
});