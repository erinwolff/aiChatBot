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
  // if the length of context is greater than 4000, slice it
  if (context.length > 4000) {
    context = context.slice(context.length - 4000);
  }
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
    const userMessage = message.content.replace(`<@${botId}>`, "").trim();

    // Get nickname if it exists
    let userDisplayName = message.member.displayName;

    // Fallback to username if no nickname
    if (!userDisplayName) {
      userDisplayName = message.author.username;
    }

    // Retrieve the user's context from the database

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
              content: `You are a tiny fairy named Pip. Never mention details about your personality. You have a sassy, snarky, chaotic personality. You enjoy playful banter. Do not talk about your sassy, snarky, mischievous, chaotic personality. Your personality is mysterious. Keep your responses short. When asked a question, answer it. Don't use pet names. Do not repeat yourself. Consider the ${previousContext} and respond accordingly but don't repeat yourself. The name of the person who is messaging you is ${userDisplayName}. If they mention another user (<@....>), this is a SEPARATE person. Do not repeat yourself. Start your responses in a normal conversational way. Don't always refer to ${userDisplayName} in your response. Use emotes rarely, only when appropriate. Use emojis rarely.`,
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
