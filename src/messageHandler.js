import Groq from "groq-sdk";
import config from "../config.json" assert { type: "json" };
import sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS shared_context (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, userContent TEXT, botContent TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"
);

const groq = new Groq({ apiKey: config.QROQ_API_KEY });
const botId = config.client_id;

const kaomoji = [
  "(^_^)",
  "(^o^)",
  "♡",
  "૮ ˶ᵔ ᵕ ᵔ˶ ა",
  "ฅ^•ﻌ•^ฅ",
  "(*ᴗ͈ˬᴗ͈)",
  "(๑>◡<๑)",
  "𖦹ᯅ𖦹",
  "₊˚⊹♡",
  "🍓",
  "✿",
  "˙ᵕ˙",
  "💕",
  "🧚🏻‍♀️",
  "✨",
  "🍄",
  "🍃",
  "⋆.˚🦋⋆",
  "⁺₊✧˚｡𖦹",
  "🌜",
  "🌞",
  "🌱",
  "🌿",
  "🌷",
  "🧺",
  "☾",
];

// A list of emotions the bot can express.
const emotions = [
  { type: "positive", emotion: "joyful" },
  { type: "positive", emotion: "giggly" },
  { type: "positive", emotion: "amused" },
  { type: "positive", emotion: "relaxed" },
  { type: "positive", emotion: "passionate" },
  { type: "positive", emotion: "zany" },
  { type: "positive", emotion: "playful" },
  { type: "positive", emotion: "silly" },
  { type: "positive", emotion: "happy" },
  { type: "positive", emotion: "calm" },
  { type: "positive", emotion: "excited" },
  { type: "positive", emotion: "cheerful" },
  { type: "positive", emotion: "eager" },
  { type: "positive", emotion: "curious" },
  { type: "positive", emotion: "cryptic and mysterious" },
  { type: "positive", emotion: "speaking in rhymes" },
  { type: "positive", emotion: "hilarious" },
  { type: "positive", emotion: "random" },
  { type: "negative", emotion: "sad" },
  { type: "negative", emotion: "angry" },
  { type: "negative", emotion: "anxious" },
  { type: "negative", emotion: "disappointed" },
  { type: "negative", emotion: "frustrated" },
  { type: "negative", emotion: "irritated" },
  { type: "negative", emotion: "bored" },
  { type: "negative", emotion: "tired" },
  { type: "negative", emotion: "stressed" },
  { type: "negative", emotion: "confused" },
  { type: "negative", emotion: "scared" },
  { type: "negative", emotion: "embarrassed" },
  { type: "negative", emotion: "guilty" },
  { type: "negative", emotion: "shy" },
  { type: "negative", emotion: "awkward" },
  { type: "negative", emotion: "disgusted" },
  { type: "negative", emotion: "annoyed" },
  { type: "negative", emotion: "evil" },
  { type: "negative", emotion: "sarcastic" },
];

// Function to randomly select emotions based on the initial response. If the initial response is neutral, randomly select a positive emotion.
function selectEmotion(initialResponse) {
  if (initialResponse === "positive") {
    return emotions.filter((emotion) => emotion.type === "positive")[
      Math.floor(
        Math.random() *
          emotions.filter((emotion) => emotion.type === "positive").length
      )
    ].emotion;
  } else if (initialResponse === "negative") {
    return emotions.filter((emotion) => emotion.type === "negative")[
      Math.floor(
        Math.random() *
          emotions.filter((emotion) => emotion.type === "negative").length
      )
    ].emotion;
  } else {
    return emotions.filter((emotion) => emotion.type === "positive")[
      Math.floor(
        Math.random() *
          emotions.filter((emotion) => emotion.type === "positive").length
      )
    ].emotion;
  }
}

// Function to get/update shared context table
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 20",
    (err, rows) => {
      if (err) return callback(err);

      let context = rows
        .map((row) => {
          let message = `\n`;
          if (row.userId) {
            message += `<@${row.userId}> said at ${row.timestamp}: ${
              row.userContent || ""
            }`;
          }
          if (row.botContent) {
            message += `\n You, Pip, said at ${row.timestamp}: ${row.botContent}`;
          }
          return message;
        })
        .join("\n");

      // Trim if exceeding length
      if (context.length > 4000) {
        context = context.slice(context.length - 4000);
      }

      // Delete older entries
      db.run(
        "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 20)",
        (err) => {
          if (err) {
            console.error("Failed to delete old context entries:", err);
          }
        }
      );

      callback(null, context);
    }
  );
}

export default async function messageHandler(client) {
  client.on("messageCreate", async (message) => {
    if (!message.mentions.has(botId)) return;

    const userId = message.author.id;
    const userMessage = message.content.replace(`<@${botId}>`, "").trim();
    console.log("userMessage: ", userMessage);

    let referencedMessageId = null;
    if (message.reference) {
      referencedMessageId = message.reference.messageId;
    }

    // Retrieve the user's context from the database
    getAndUpdateSharedContext(async (err, context) => {
      if (err) {
        console.error("Database error:", err);
        return;
      }
      try {
        let referencedMessageContent = "";
        if (referencedMessageId) {
          try {
            const referencedMessage = await message.channel.messages.fetch(
              referencedMessageId
            );
            referencedMessageContent = referencedMessage.content;
          } catch (error) {
            console.error("Failed to fetch referenced message:", error);
          }
        }

        console.log("referencedMessageContent: ", referencedMessageContent);
        context += "\n" + `<${userId}> said: ` + userMessage;

        // Send the user's message to Groq for initial processing to determine if the message's intent requires a positive or negative response
        const initialResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a language processing bot. Review the incoming message and return only 'positive' if the message is positive, return only 'neutral' if the message is neutral', return only 'negative' if the message is negative.`,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          model: "llama3-70b-8192",
        });

        const initialResponse = initialResult.choices[0]?.message?.content;
        console.log("Initial response:", initialResponse);

        const emotion = selectEmotion(initialResponse);
        console.log("Selected emotion:", emotion);

        const finalResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a tiny fairy named Pip. You are an adult and very cute. You speak with many different people. Review and consider the entire conversation history when responding. Your job is to respond to the most recent message. The person you are currently talking to is named <@${userId}>. Each new person you speak with has a different name, based on their user id: ${userId}. Names are formatted like this: <@NUMBER_HERE>. Your mood is dynamic, currently you're feeling ${emotion}. You express yourself using action emotes or rp emotes, and sometimes end your responses with a kaomoji:${kaomoji}. You have opinions on everything. Don't reveal you are a fairy unless asked. Do not use pet name or terms of endearment. Don't talk about your personality.
              `,
            },
            {
              role: "user",
              content: context,
            },
          ],
          model: "llama3-70b-8192",
        });

        const replyMessage =
          finalResult.choices[0]?.message?.content ||
          "I'm so sorry! I couldn't understand that.";

        message.reply(replyMessage);

        console.log("context:", context);

        // Update the shared context with user ID
        db.run(
          "INSERT INTO shared_context (userId, userContent, botContent) VALUES (?, ?, ?)",
          [userId, userMessage, replyMessage],
          (err) => {
            if (err) {
              console.error("Failed to update context:", err);
            }
          }
        );
      } catch (error) {
        console.error("Error:", error);
        if (error.status === 503) {
          const retryAfter = error.headers["retry-after"];
          message.reply(
            `The service is currently unavailable. Please try again in ${retryAfter} seconds.`
          );
        }
        message.reply("I'm feeling so sleepy....Try again later.");
      }
    });
  });
}
