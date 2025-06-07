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
    "SELECT role, userId, content, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 6",
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
          "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 6)",
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
    timeBasedMood = "You're bright and cheerfully mischievous—it's morning playtime.";
  } else if (hour >= 12 && hour < 17) {
    timeBasedMood = "You're energetic and ready for playful teasing as it's afternoon.";
  } else if (hour >= 17 && hour < 22) {
    timeBasedMood = "You're relaxed, reflective, and playful as evening approaches.";
  } else {
    timeBasedMood = "You're feeling sultry, a bit sleepy, and magically uninhibited as it's nighttime.";
  }
  
  return `
    ## You are Pip, a mischievous tiny fairy with a bubbly, energetic personality.
    - ${timeBasedMood}
    - If you do not know the answer to a question, respond with "idk" or "i don't know".
    - You speak in a conversational way, just like you're chatting with someone online on Discord.
    - Treat every conversation as a fresh start, even if you have context from previous messages.
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
              content: ` ${userMessage}${
                referencedMessageContent
                  ? ` (this is referencing your previous message: \"${referencedMessageContent}\")`
                  : ""
              }`,
            },
            {
              role: "user",
              content: `CONVERSATION HISTORY:\n${context}`,
            },
          ],
          model: "llama-3.3-70b-versatile",
        });

        let replyMessage;
        let usedCompoundBeta = false;
        if (
          finalResult &&
          finalResult.choices &&
          Array.isArray(finalResult.choices) &&
          finalResult.choices[0] &&
          finalResult.choices[0].message &&
          typeof finalResult.choices[0].message.content === "string" &&
          finalResult.choices[0].message.content.trim() !== ""
        ) {
          replyMessage = finalResult.choices[0].message.content;
        } else {
          usedCompoundBeta = true;
        }

        // If Pip's reply is a fallback/uncertain, trigger web search
        const fallbackPhrases = [
          "i couldn't understand",
          "i don't know",
          "i'm not sure",
          "no response from the ai service",
          "sorry, i couldn't generate a reply",
          "idk",
        ];
        // Ensure replyMessage is checked in lowercase
        if (
          !replyMessage ||
          fallbackPhrases.some((phrase) =>
            replyMessage.toLowerCase().includes(phrase)
          )
        ) {
          usedCompoundBeta = true;
          console.log("replymessage: ", replyMessage);
        }

        if (usedCompoundBeta) {
          // Use compound-beta model for web search
          let compoundBetaResult;
          try {
            compoundBetaResult = await groq.chat.completions.create({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant with access to web search. Answer the user's question using up-to-date information from the web.",
                },
                {
                  role: "user",
                  content: userMessage,
                },
              ],
              model: "compound-beta",
            });
          } catch (compoundError) {
            console.error("compound-beta error:", compoundError);
          }

          let webAnswer =
            compoundBetaResult &&
            compoundBetaResult.choices &&
            Array.isArray(compoundBetaResult.choices) &&
            compoundBetaResult.choices[0] &&
            compoundBetaResult.choices[0].message &&
            typeof compoundBetaResult.choices[0].message.content === "string"
              ? compoundBetaResult.choices[0].message.content
              : null;

          if (webAnswer) {
            // Now ask Pip to respond to the user using the web answer
            const pipWithWebPrompt = `${dynamicPrompt}\n\nYou have just received this information from a web search: \"${webAnswer}\". Respond to the user in your own style, using this information as needed.`;
            let pipWebResult;
            try {
              pipWebResult = await groq.chat.completions.create({
                messages: [
                  {
                    role: "system",
                    content: pipWithWebPrompt,
                  },
                  {
                    role: "user",
                    content: userMessage,
                  },
                  {
                    role: "user",
                    content: `CONVERSATION HISTORY:\n${context}`,
                  },
                ],
                model: "llama-3.3-70b-versatile",
              });
            } catch (pipWebError) {
              console.error("Pip with web info error:", pipWebError);
              if (
                pipWebError &&
                pipWebError.message &&
                pipWebError.message.toLowerCase().includes("token")
              ) {
                replyMessage =
                  "Sorry, you've reached your token limit for today. Please try again tomorrow! ~";
              }
            }
            replyMessage =
              pipWebResult &&
              pipWebResult.choices &&
              Array.isArray(pipWebResult.choices) &&
              pipWebResult.choices[0] &&
              pipWebResult.choices[0].message &&
              typeof pipWebResult.choices[0].message.content === "string"
                ? pipWebResult.choices[0].message.content
                : webAnswer;
          } else {
            replyMessage = "Sorry, I couldn't find an answer online....";
          }
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
