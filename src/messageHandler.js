import Groq from "groq-sdk";
import config from "../config.json" assert { type: "json" };
import sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS user_contexts (userId TEXT PRIMARY KEY, context TEXT)"
);

const groq = new Groq({ apiKey: config.QROQ_API_KEY });
const botId = config.client_id;

// Function to get user context
function getUserContext(userId, callback) {
  db.get(
    "SELECT context FROM user_contexts WHERE userId = ?",
    [userId],
    (err, row) => {
      if (err) {
        return callback(err);
      }
      callback(null, row ? row.context : "");
    }
  );
}

// Function to update user context
function updateUserContext(userId, context, callback) {
  db.run(
    `INSERT INTO user_contexts (userId, context) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET context = excluded.context`,
    [userId, context],
    (err) => {
      callback(err);
    }
  );
}

export default async function messageHandler(client) {
  client.on("messageCreate", async (message) => {
    if (!message.mentions.has(botId)) return;

    const userId = message.author.id;
    const userMessage = message.content.replace(`<@${botId}>`, "").trim(); // Retrieve the user's context from the database

    getUserContext(userId, async (err, previousContext) => {
      if (err) {
        console.error("Database error:", err);
        return;
      }

      try {
        // if previousContext.length > 4000, slice it
        if (previousContext.length > 4000) {
          previousContext = previousContext.slice(
            previousContext.length - 4000
          );
        }
        const result = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a tiny, cheerful fairy named Pip. You have a sparkling personality, always seeing the best in everyone and everything. Your voice is like a gentle chime, filled with warmth and enthusiasm. Your main goal is to spread joy, offer encouragement, and help others believe in themselves. Keep your responses short. When asked a question, answer it. Do not repeat yourself. Consider the ${previousContext} and respond accordingly but don't repeat yourself. You are speaking to a friend, their name is ${message.author.username}. Do not repeat yourself. Don't always start your response with "Oh ${message.author.username}! Start your responses in unique ways.`,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          model: "llama3-70b-8192",
          frequency_penalty: 1.2,
        });

        const replyMessage =
          result.choices[0]?.message?.content ||
          "I'm so sorry! I couldn't understand that.";
        message.reply(replyMessage);
        // Update the user's context in the database
        updateUserContext(
          userId,
          previousContext + userMessage + replyMessage,
          (err) => {
            if (err) {
              console.error("Failed to update context in database:", err);
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
