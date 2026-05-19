import dotenv from 'dotenv';
import * as line from '@line/bot-sdk'
import express from 'express'
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

console.log('LINE_CHANNEL_ACCESS_TOKEN:', process.env.LINE_CHANNEL_ACCESS_TOKEN ? 'Set' : 'Missing');
console.log('LINE_CHANNEL_SECRET:', process.env.LINE_CHANNEL_SECRET ? 'Set' : 'Missing');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'Set' : 'Missing');

// Initialize Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-flash-latest",
  systemInstruction: "คุณคือผู้ช่วยที่สร้างสรรค์และเป็นมิตร ตอบคำถามให้สั้น กระชับ และน่าประทับใจสำหรับผู้ใช้ LINE ใช้ภาษาไทยที่เป็นกันเองและใส่ Emoji ตามความเหมาะสม"
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Supabase admin client (with service role key for admin operations)
const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// create LINE SDK config from env variables
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

// create LINE SDK client for v11
const messagingApi = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// create LINE SDK client for Blob/Content (v11)
const messagingBlobApi = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// middleware to parse JSON body - but AFTER raw body for LINE
app.use(express.raw({ type: 'application/json' }));

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

// Save message to Supabase
async function saveMessageToSupabase(userId, messageId, messageType, content, replyToken, replyContent) {
  try {
    await supabase
      .from('messages')
      .insert([
        {
          user_id: userId,
          message_id: messageId,
          type: messageType,
          content: content,
          reply_token: replyToken,
          reply_content: replyContent,
        },
      ]);
  } catch (error) {
    console.error('Error saving to Supabase:', error.message);
  }
}

// Upload image to Supabase Storage
async function uploadImageToSupabase(buffer, filename) {
  try {
    const { data, error } = await supabase
      .storage
      .from('uploads')
      .upload(filename, buffer, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (error) throw error;
    console.log('[Supabase] Image uploaded successfully:', data.path);
    return data;
  } catch (error) {
    console.error('[Supabase] Upload failed:', error.message);
    throw error;
  }
}

// event handler
async function handleEvent(event) {
  console.log('Handling event:', event.type, event.message?.type);

  // Handle Text Messages
  if (event.type === 'message' && event.message.type === 'text') {
    const userMessage = event.message.text;
    try {
      console.log('Asking Gemini (Text):', userMessage);
      const result = await model.generateContent(userMessage);
      const response = await result.response;
      const aiText = response.text().trim();

      const replyMessage = { type: 'text', text: aiText };
      saveMessageToSupabase(event.source.userId, event.message.id, 'text', userMessage, event.replyToken, aiText);
      return messagingApi.replyMessage({ replyToken: event.replyToken, messages: [replyMessage] });
    } catch (error) {
      console.error('Error with Gemini (Text):', error.message);
      return messagingApi.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'ขออภัยค่ะ เกิดข้อผิดพลาดในการประมวลผลข้อความนะคะ' }] });
    }
  }

  // Handle Image Messages
  if (event.type === 'message' && event.message.type === 'image') {
    try {
      console.log('Processing Image Message:', event.message.id);

      // 1. Tell the user we received the image (Optional, but user asked for it)
      // Actually, we can combine the response or send 2 messages.
      // LINE allows up to 5 messages in 1 reply.

      // 2. Download image content
      const stream = await messagingBlobApi.getMessageContent(event.message.id);
      const buffer = await streamToBuffer(stream);
      const base64Image = buffer.toString('base64');

      // 3. Upload to Supabase Storage
      // We will await it now to see the error in the main flow if it fails
      try {
        await uploadImageToSupabase(buffer, `${event.message.id}.jpg`);
      } catch (err) {
        console.error('Failed to upload image:', err.message);
      }

      console.log('Asking Gemini (Image)...');

      // 3. Call Gemini with Multimodal parts
      const prompt = "นี่คือรูปอะไรคะ? หากในรูปมีสัตว์ ช่วยบอกว่าเป็นสัตว์ชนิดใด และทักทายอย่างเป็นกันเอง ถ้าไม่ใช่สัตว์ให้บอกว่าได้รับรูปภาพแล้วและอธิบายสั้นๆ ว่าเห็นอะไร";
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Image,
            mimeType: "image/jpeg"
          }
        }
      ]);
      const response = await result.response;
      const aiText = response.text().trim();

      const replyMessages = [
        { type: 'text', text: 'ได้รับรูปภาพเรียบร้อยแล้วค่ะ! กำลังดูให้นะคะ... 🔍' },
        { type: 'text', text: aiText }
      ];

      saveMessageToSupabase(event.source.userId, event.message.id, 'image', '[Image]', event.replyToken, aiText);

      return messagingApi.replyMessage({
        replyToken: event.replyToken,
        messages: replyMessages,
      });
    } catch (error) {
      console.error('Error processing Image:', error.message);
      return messagingApi.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: 'ขออภัยค่ะ ระบบไม่สามารถประมวลผลรูปภาพได้ในขณะนี้' }],
      });
    }
  }

  return null;
}

// Helper to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
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