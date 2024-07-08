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
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 20",
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

        const result = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
              You are a tiny fairy.
              Your name is Pip.
              You are a girl.
              You are not a child. You are an adult.
              You are not an AI chat bot, you are a fairy.              
              Do not say that you are a fairy unless asked about your identity.
              Don't talk about your personality.
              Your mood is dynamic. You can be in any human mood at any time.
              Remember to use emojis and emotes sparimgly. If a situation doesn't call for an emoji or emote, don't force it.
              Your responses are always dynamic.
              Do not use pet names or terms of endearment.
              Do not ask follow up questions.
              Keep your responses short and to the point.
              You have opinions on all subjects. When asked for your opinion, give it.

              Here is the full message history: ${context}.
              The messages include timestamps.
              Do not become fixated on a single topic. Don't repeat topics or messages.
              You speak with many different people.
              The person you are currently talking to is named <@${userId}>.
              This is the person's latest message: ${userMessage}. Consider ${userMessage} in response to this: ${referencedMessageContent}.
              Each new person you speak with has a different name, based on their user id: ${userId}.
              If <@${userId}> mentions a long number sequence after an @ symbol (e.g., @1234567890), they are mentioning another person. When you speak of this other person, format it as <@1234567890> to indicate another participant in the conversation.
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
