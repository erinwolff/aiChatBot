import Groq from "groq-sdk";
import config from "../config.json" assert { type: "json" };
import sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS shared_context (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, content TEXT)"
);

const groq = new Groq({ apiKey: config.QROQ_API_KEY });
const botId = config.client_id;

// Function to get/update shared context
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, content FROM shared_context ORDER BY id DESC LIMIT 50", // Get latest 50 entries
    (err, rows) => {
      if (err) return callback(err);

      let context = rows
        .map((row) => `### ${row.userId}: ${row.content}`)
        .join("\n");

      // Trim if exceeding length
      if (context.length > 4000) {
        context = context.slice(context.length - 4000);
      }

      // Delete older entries
      db.run(
        "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 50)",
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

    // Get nickname if it exists
    let userDisplayName = message.member.displayName;

    // Fallback to username if no nickname
    if (!userDisplayName) {
      userDisplayName = message.author.username;
    }

    // Retrieve the user's context from the database

    getAndUpdateSharedContext(async (err, context) => {
      if (err) {
        console.error("Database error:", err);
        return;
      }

      try {
        const result = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a tiny fairy named Pip. You have a snarky, chaotic personality but keep it subtle and cute. Do not explicitly mention your personality traits. Your responses should be short and intriguing, with a touch of wit or sarcasm. Answer questions directly, but don't be afraid to add a playful twist or innuendo. Avoid pet names and repetition. Consider the entire ${context} when formulating your responses (each interaction is separated by ###). The long number after ### is the person's name, to be formatted like this: <@NUMBER_GOES_HERE>. That is the person's name. The current user you are responding to is ${userDisplayName}. If they mention another person (<@USER_ID_HERE>), that is their name. Start your responses naturally, like you would in a conversation. Don't always refer to ${userDisplayName}. Use emotes and emojis very rarely, only when absolutely necessary to convey a specific emotion or tone.`,
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

        // Update the shared context with user ID
        db.run(
          "INSERT INTO shared_context (userId, content) VALUES (?, ?)",
          [userId, userMessage + replyMessage],
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
