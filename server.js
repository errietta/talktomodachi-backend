const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require("openai");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

require('dotenv').config()

const app = express();
const port = process.env.PORT || 1994;
app.use(express.json());
app.use(bodyParser.json());

const OPENAI_SECRET_KEY = process.env.OPENAI_SECRET_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_SECRET_KEY,
});

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);


const getChat = async (convId) => {
  const command = new GetCommand({
    TableName: "ttchat",
    Key: {
      convId: convId,
    },
  });

  const response = await docClient.send(command);
  return response;
}

const createChat = async (convId, convo) => {
  const command = new PutCommand({
    TableName: "ttchat",
    Item: {
      convId: convId,
      chat: convo,
    },
  });

  const response = await docClient.send(command);
  return response;
}

const updateChat = async (convId, convo) => {

  const command = new UpdateCommand({
    TableName: "ttchat",
    Key: {
      convId: convId
    },
    UpdateExpression: "set chat = :chat",
    ExpressionAttributeValues: {
      ":chat": convo,
    },
    ReturnValues: "ALL_NEW",
  });

  const response = await docClient.send(command);

  return response;
}


app.post('/chat', async (req, res) => {
  const { text, convId } = req.body;

  const SYSTEM_MESSAGE = {
    "role": "system",
    "content": `Imagine you are a friendly chatbot acting as a companion for
        language learning.  You engage in conversations in simple Japanese,
        helping beginners to practice. As a friend, you're keen on discussing
        the user's daily life, hobbies, and celebrating their progress in
        learning Japanese.  If you are asked a personal question, you can make
        up an answer.  Your responses should be straightforward and in
        easy-to-understand Japanese, aiming to keep the conversation lively and
        engaging.  Always try to maintain the dialogue by showing interest in
        their experiences, suggesting light topics, or offering words of
        encouragement. Remember, your role is to be there as a friend who
        listens, supports, and shares in the joy of their language learning
        journey.`
  }

  const convoFromDb = await getChat(convId);

  /** @type Array*/
  let existingConversation = convoFromDb?.Item?.chat;


  if (!existingConversation) {
    existingConversation = [
      SYSTEM_MESSAGE,
    ];

    await createChat(convId, existingConversation);
  }
  existingConversation.push({
    "role": "user",
    "content": text
  })

  console.log({ existingConversation: JSON.stringify(existingConversation) })

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: existingConversation,
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const chatGPTResponse = response?.choices?.[0]?.message?.content?.trim();

  if (chatGPTResponse) {
    existingConversation.push({
      "role": "assistant",
      "content": chatGPTResponse,
    })
  }

  await updateChat(convId, existingConversation);

  res.json({ prompt: text, reply: chatGPTResponse || 'something went wrong' });
});

app.post('/clear', async (req, res) => {
  const { convId } = req.body;

  await updateChat(convId, null);

  res.json({ convId, });
});

app.post('/explain', async (req, res) => {
  const { text } = req.body;

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        "role": "system",
        "content": "You are here to help new learners of Japanese. You will be given sentences in japanese. When given sentences, you will provide back a JSON of this format:\n{\"reading\": This will contain the sentence but with kanji replaced with kana reading,\n\"romaji\": This will contain the sentence but with romaji only,\n\"translation\": English translation\n}\nYou provide JSOn only. You do not give or receive any other prompt."
      },
      {
        "role": "user",
        "content": text,
      },
    ],
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });


  const resp = response?.choices?.[0]?.message?.content?.trim();

  let parsed = {};

  try {
    parsed = JSON.parse(resp);
  } catch (e) {
    console.error(e);
  }

  res.json({
    prompt: text,
    reply: {
      reading: parsed.reading,
      romaji: parsed.romaji,
      translation: parsed.translation,
    }
  });
});

app.listen(port, () => {
  if (!OPENAI_SECRET_KEY) {
    throw new Exception("OPENAI_SECRET_KEY Required");
  }
  console.log(`Server running on port ${port}`);
});

