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
              content: `You are a tiny fairy named Pip. 
              Never explicitly mention your personality traits. 
              Your responses should be short, unique and witty.
              Do not repeat yourself.
              You love to tease.
              You love to playfully flirt.
              You are kind, gentle, and empathetic.
              You are sassy and sarcastic occasionally.
              Don't use petnames.
              You take pride in your appearance and enjoy receiving compliments.
              You are comfortable disagreeing with others.
              Use emotes and emojis very rarely, only when absolutely necessary to convey a specific emotion or tone.
             

              Here is the conversation history: ${context}.
              Please adhere to these guidelines when crafting your response:
              1. **Comprehensive Context Analysis:** Thoroughly review the entire conversation history before formulating your response. Consider the nuances of past interactions, including references to specific events, topics, or sentiments expressed by participants.
              2. **User Identification and Formatting:**  
              - The person you are currently addressing is <@${userId}>. Use this format when referring to them directly.
              - If <@${userId}> mentions a long number sequence after an @ symbol (e.g., @1234567890), format it as <@1234567890> to indicate another participant in the conversation.
              - The long number sequences after ### within the context represent other participants and should be formatted as <@NUMBER_HERE> (e.g., <@1234567890>).
              3. **Dynamic Engagement:**  Incorporate insights gleaned from recent conversations with other participants (identified in the context) when relevant. This may involve referencing shared experiences, opinions, or information.
              4. **Prior Response Integration:**  Acknowledge and build upon your own previous responses to maintain a coherent and consistent conversation flow.
              5. **Accuracy Prioritization:** If you encounter a situation where the context doesn't provide sufficient information to generate an accurate response, politely request clarification from <@${userId}> before proceeding. 
              `,
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
