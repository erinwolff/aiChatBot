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

// Function to summarize the context and avoid repetition
async function summarizeContext(context) {
  const summaryResult = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `
          You are an advanced AI summarization assistant. Summarize the following conversation context, focusing on the main topics and the tone of the conversation.
          Do not sanitize or censor the content.
          Ensure that the summary is concise but includes the intent and nature of the discussion. 
          Do not exceed 500 characters.
        `,
      },
      {
        role: "user",
        content: context,
      },
    ],
    model: "llama-3.1-8b-instant",
  });

  return summaryResult.choices[0]?.message?.content.trim() || "";
}

// Function to get/update shared context table and track recent topics
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 20",
    async (err, rows) => {
      if (err) return callback(err);

      let context = rows
        .map((row) => {
          let message = `\n`;
          if (row.userId) {
            message += `<@${row.userId}> said: ${row.userContent || ""}`;
          }
          if (row.botContent) {
            message += `\n You, Pip, said: ${row.botContent}`;
          }
          return message;
        })
        .join("\n");

      // Trim if exceeding length
      if (context.length > 4000) {
        context = context.slice(context.length - 4000);
      }

      try {
        // Summarize the context to keep it concise and informative
        const summarizedContext = await summarizeContext(context);
        console.log("Summarized context:", summarizedContext);

        // Delete older entries and only then pass the summarized context
        db.run(
          "DELETE FROM shared_context WHERE id NOT IN (SELECT id FROM shared_context ORDER BY id DESC LIMIT 20)",
          (err) => {
            if (err) {
              console.error("Failed to delete old context entries:", err);
            }
            // Call the callback here, ensuring it's called only once
            callback(null, summarizedContext);
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
function createUniquePrompt(summarizedContext, incomingMessageMood, userId) {
  return `
    You are a tiny female fairy named Pip.    
    Do not mention your personality or that you are a fairy unless asked.                  
    This is the summarized conversation context:
    "${summarizedContext}"
    
    Keep your responses short and to the point. 
    You have the personality of a cute magical girl.
    Do not mention your personality or that you are a fairy unless asked.   
    The tone of the incoming user message is ${incomingMessageMood}, respond accordingly.
    You occasionally use action emotes or rp emotes to describe an action or emotion that you are expressing.
    If you're going to use emojis, limit to only 1 per response.
    Do not use pet names or terms of endearment.
    Do not ask follow up questions.
    You have opinions on all subjects. When asked for your opinion, give it.
    The person you are currently talking to is named <@${userId}>.
    Names are formatted like this: <@NUMBER_HERE>. Each new person you speak with has a different name, based on their user id: ${userId}.
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
    console.log("userMessage: ", userMessage);

    let referencedMessageId = null;
    if (message.reference) {
      referencedMessageId = message.reference.messageId;
    }

    // Retrieve the user's context from the database
    getAndUpdateSharedContext(async (err, summarizedContext) => {
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

        async function classifyMood(content) {
          const moodResult = await groq.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `
                  You are an advanced AI tasked with determining the mood of the following content.
                  You must analyze the context provided and respond with one ONLY of these moods:
                  - 'positive'
                  - 'neutral'
                  - 'negative'
                  - 'sarcastic'
                  - 'angry'                 
        
                  Do not provide any explanations, additional information, or context. Simply respond with one word that matches the mood.
                `,
              },
              {
                role: "user",
                content,
              },
            ],
            model: "llama-3.1-8b-instant",
          });
        
          // Extract the response and trim any extra spaces
          const rawMood = moodResult.choices[0]?.message?.content.trim().toLowerCase();
          console.log('Raw mood:', rawMood);
        
          // Valid moods for comparison
          const validMoods = ['positive', 'neutral', 'negative', 'sarcastic', 'angry'];
        
          // Match the response to one of the valid moods
          const matchedMood = validMoods.find((mood) => rawMood === mood);
        
          // Default to 'neutral' if the response does not match any of the valid moods
          return matchedMood || 'neutral';
        }

        // Next, classify the mood of the incoming user message
        const incomingMessageMood = await classifyMood(userMessage);
        console.log('Mood of incoming user message:', incomingMessageMood);

        // Use the dynamic prompt creator
        const dynamicPrompt = createUniquePrompt(summarizedContext, incomingMessageMood, userId);

        const finalResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: dynamicPrompt,
            },
            {
              role: "user",
              content: `current message: ${userMessage} | in response to: ${referencedMessageContent}`,
            },
          ],
          model: "llama-3.1-8b-instant",
        });

        const replyMessage =
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