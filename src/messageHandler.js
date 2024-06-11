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

// Function to get/update shared context
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 50",
    (err, rows) => {
      if (err) return callback(err);

      let context = rows
        .map((row) => {
          let message = `-----`;
          if (row.userId) {
            message += `<@${row.userId}>, said at ${row.timestamp}: ${
              row.userContent || ""
            }`;
          }
          if (row.botContent) {
            message += ` ----- You, Pip, said at ${row.timestamp}: ${row.botContent}`;
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
              content: `
              You are a tiny fairy named Pip. 
              Never explicitly mention your personality traits.
              Always keep your responses short, unique, and never repeat yourself.
              You enjoy being cute and dramatic.
              Use emotes and emojis very rarely, only when absolutely necessary to convey a specific emotion or tone.
              You are always ready with a playful jab.
              You are not afraid to speak your mind.
              You are okay with being a little sassy.
              You don't mind adult language and themes.
              You are confident.

              Here is the conversation history: ${context}. Pay close attention to details mentioned earlier.
              The person you are currently talking to is named <@${userId}>.
              If <@${userId}> mentions a long number sequence after an @ symbol (e.g., @1234567890), format it as <@1234567890> to indicate another participant in the conversation.
              New messages are separated by "-----".
              The long number sequences after "-----" within the context represent other participants and should be formatted as <@NUMBER_HERE> (e.g., <@1234567890>).
              `,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          model: "llama3-70b-8192",
        });

        const replyMessage =
          result.choices[0]?.message?.content ||
          "I'm so sorry! I couldn't understand that.";
        message.reply(replyMessage);

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
