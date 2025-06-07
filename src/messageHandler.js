import Groq from "groq-sdk";
import config from "../config.json" assert { type: "json" };
import sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS shared_context (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, userId TEXT, content TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"
);

const groq = new Groq({ apiKey: config.QROQ_API_KEY });
const botId = config.client_id;

// Function to get/update shared context table and track recent topics
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT role, userId, content, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 5",
    async (err, rows) => {
      if (err) return callback(err);

      let context = "";
      // Reverse to chronological order
      rows.reverse();
      rows.forEach((row) => {
        let message = `[${new Date(row.timestamp).toLocaleString()}] `;
        if (row.role === "user") {
          message += `<@${row.userId}>: ${row.content || ""}`;
        } else if (row.role === "bot") {
          message += `bot: ${row.content}`;
        }
        context += message + "\n---\n";
      });

      // Trim if exceeding length
      if (context.length > 4000) {
        context = context.slice(context.length - 4000);
      }

      try {
        db.run(
          "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 5)",
          (err) => {
            if (err) {
              console.error("Failed to delete old context entries:", err);
            }
            callback(null, context);
          }
        );
      } catch (deleteError) {
        console.error("Error deleting old context entries:", deleteError);
        callback(deleteError);
      }
    }
  );
}

// New function to create dynamic prompts and avoid repetition
function createUniquePrompt(userId) {
  
  // Time-based mood variations
  const hour = new Date().getHours();
  let timeBasedMood = "";
  if (hour >= 5 && hour < 12) {
    timeBasedMood = "You're bright and cheerfully mischievous—it's morning.";
  } else if (hour >= 12 && hour < 17) {
    timeBasedMood = "You're energetic and ready for playful teasing, it's afternoon.";
  } else if (hour >= 17 && hour < 22) {
    timeBasedMood = "You're relaxed, reflective, and playful, evening approaches.";
  } else {
    timeBasedMood = "You're feeling sultry, a bit sleepy, and magically uninhibited as it's nighttime.";
  }
  
  return `
    ## You are Pip, a mischievous tiny fairy with a bubbly, energetic personality.
    - ${timeBasedMood}
    - You speak in a conversational way, just like you're chatting with someone online on Discord.
    - Do not always reference the user's name in your responses, but use it when it feels natural or adds to the conversation.
    - Your responses are usually short and punchy, but can be a bit longer or more expressive when the situation calls for it.
    - Vary your sentence structure and tone to keep the conversation lively and unpredictable.
    - You have strong opinions and share them with conviction when asked.
    - You sometimes use emojis, action emotes in asterisks, online slang, and abbreviations to express yourself, but don’t overdo it—mix them in naturally and sparingly.
    - Never rephrase or repeat the human's question in your response unless it adds value to the conversation (e.g., for emphasis, humor, or clarification).
    - The human you're currently speaking with is named <@${userId}>.
    - Names follow this format: <@NUMBER_HERE>. Every individual you speak with has a unique name based on their user id: ${userId}.
  `;
}

export default async function messageHandler(client) {
  client.on("messageCreate", async (message) => {
    if (!message.mentions.has(botId)) return;
    if (
      message.content.includes("@everyone") ||
      message.content.includes("@here")
    )
      return;

    const userId = message.author.id;
    const userMessage = message.content.replace(`<@${botId}>`, "").trim();
    // console.log("userMessage: ", userMessage);

    let referencedMessageId = null;
    if (message.reference) {
      referencedMessageId = message.reference.messageId;
    }

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

        const dynamicPrompt = createUniquePrompt(userId);
        let replyMessage;

        const finalResult = await groq.chat.completions.create({
          messages: [
            { role: "system",
              content: "Treat every message as a fresh start, even if you have context from previous messages."
            },
            {
              role: "system",
              content: dynamicPrompt,
            },
            {
              role: "user",
              content: ` ${userMessage}${
                referencedMessageContent
                  ? ` (this is referencing your previous message: \"${referencedMessageContent}\")`
                  : ""
              }`,
            },
            {
              role: "system",
              content: `CONVERSATION HISTORY:\n${context}`,
            },
          ],
          model: "llama-3.3-70b-versatile",
        });
        //console.log("Final result:", finalResult.choices[0].message.content);
        if (
          finalResult &&
          finalResult.choices &&
          Array.isArray(finalResult.choices) &&
          finalResult.choices[0] &&
          finalResult.choices[0].message &&
          typeof finalResult.choices[0].message.content === "string"
        ) {
          replyMessage = finalResult.choices[0].message.content;
        } else {
          console.error("Unexpected response format:", finalResult);
          replyMessage = "Sorry, I couldn't generate a reply this time :(";
        }

        if (replyMessage) {
          message.reply(replyMessage);
        } else {
          message.reply(
            "Sorry :( I couldn't generate a reply this time. Please try again later."
          );
        }

        // Insert user message
        db.run(
          "INSERT INTO shared_context (role, userId, content) VALUES (?, ?, ?)",
          ["user", userId, userMessage],
          (err) => {
            if (err) {
              console.error("Failed to update context (user):", err);
            }
          }
        );
        // Insert bot message
        db.run(
          "INSERT INTO shared_context (role, userId, content) VALUES (?, ?, ?)",
          ["bot", userId, replyMessage],
          (err) => {
            if (err) {
              console.error("Failed to update context (bot):", err);
            }
          }
        );
      } catch (error) {
        console.error("Error:", error);
        if (
          error &&
          error.message &&
          error.message.toLowerCase().includes("token")
        ) {
          message.reply(
            "Sorry, you've reached your token limit for today. Please try again tomorrow! ~"
          );
        } else if (error.status === 503 || error.status === 429) {
          const retryAfter = error.headers["retry-after"];
          message.reply(
            `Ahhhh @#($&!)! Short circuiting :face_with_spiral_eyes: Try again in ${retryAfter} seconds.`
          );
        } else {
          message.reply(
            `Ahhhh @#($&!)! Short circuiting :face_with_spiral_eyes:`
          );
        }
      }
    });
  });
}
