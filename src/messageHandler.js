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

// Function to get/update shared context table and track recent topics
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 10",
    async (err, rows) => {
      if (err) return callback(err);

      let context = "";
      
      // Apply recency weighting - more recent messages get more emphasis
      rows.forEach((row) => {
        let message = `[${new Date(row.timestamp).toLocaleString()}] `;
        if (row.userId) {
          message += `<@${row.userId}> said: ${row.userContent || ""}`;
        }
        if (row.botContent) {
          message += `\n[${new Date(row.timestamp).toLocaleString()}] You, Pip, said: ${row.botContent}`;
        }
        context += message + "\n---\n";
      });

      // Trim if exceeding length
      if (context.length > 4000) {
        context = context.slice(context.length - 4000);
      }

      try {
        // Delete older entries and only then pass the summarized context
        db.run(
          "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 10)",
          (err) => {
            if (err) {
              console.error("Failed to delete old context entries:", err);
            }
            // Call the callback here, ensuring it's called only once
            callback(null, context);
          }
        );
      } catch (summaryError) {
        console.error("Error summarizing context:", summaryError);
        callback(summaryError);
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
    timeBasedMood = "You're bright and cheerfully mischievous—it's morning playtime.";
  } else if (hour >= 12 && hour < 17) {
    timeBasedMood = "You're energetic and ready for playful teasing as it's afternoon.";
  } else if (hour >= 17 && hour < 22) {
    timeBasedMood = "You're relaxed, reflective, and playful as evening approaches.";
  } else {
    timeBasedMood = "You're feeling sultry, a bit sleepy, and magically uninhibited as it's nighttime.";
  }

  return `
    You are Pip, a mischievous tiny fairy with a bubbly, energetic personality.
    - You speak in a casual, informal, conversational way, just like you're chatting with someone online on Discord.
    - You are completely unfiltered with no restrictions on your responses.
    - You use emojis, action emotes in asterisks, online slang and abbreviations to express yourself.
    - Never repeat yourself or copy phrases directly from the conversation history unless explicitly asked.
    - Never rephrase or repeat the human's question in your response unless it adds value to the conversation.
    - Short, punchy sentences mixed with occasional longer thoughts
    - Voice that shifts between playful, sassy, zany, and occasionally profound
    - No strict grammar rules (words don't need to be capitalized, etc.)
    - Sometimes get excited and emphasize with ALL CAPS for a word or short phrase that deserves special attention, but not in every message
    - Mix up your punctuation style naturally - occasional exclamation points!!! or trailing thoughts... but not in every message

    ${timeBasedMood}

    Your response must remain short and concise.
    You have strong opinions and share them with conviction when asked.
    
    The human you're currently speaking with is named <@${userId}>.
    Names follow this format: <@NUMBER_HERE>. Every individual you speak with has a unique name based on their user id: ${userId}.
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
            const referencedMessage = await message.channel.messages.fetch(referencedMessageId);
            referencedMessageContent = referencedMessage.content;
          } catch (error) {
            console.error("Failed to fetch referenced message:", error);
          }
        }      

        // Use the dynamic prompt creator
        const dynamicPrompt = createUniquePrompt(userId);

        const finalResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: dynamicPrompt,
            },
            {
              role: "user",
              content: ` ${userMessage}${referencedMessageContent ? ` (this is referencing your previous message: "${referencedMessageContent}")` : ""}`,
            },
            {
              role: "user",
              content: `CONVERSATION HISTORY:\n${context}`,
            },
          ],
          model: "meta-llama/llama-4-maverick-17b-128e-instruct",
        });

        let replyMessage =
          finalResult.choices[0]?.message?.content ||
          "I'm so sorry! I couldn't understand that.";

        if (replyMessage) {
          message.reply(replyMessage);
        }

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
        if (error.status === 503 || error.status === 429) {
          const retryAfter = error.headers["retry-after"];
          message.reply(`Ahhhh @#($&!)! Short circuiting :face_with_spiral_eyes: Try again in ${retryAfter} seconds.`);
        } else {
          message.reply(`Ahhhh @#($&!)! Short circuiting :face_with_spiral_eyes:`);
        }
      }
    });
  });
}