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

let moodScore = 0;

const moods = [
  { mood: "Furious: Filled with intense anger and rage.", score: -10 },
  { mood: "Seething: Boiling with suppressed anger.", score: -9 },
  { mood: "Infuriated: Extremely angry and impatient.", score: -8 },
  { mood: "Wrathful: Consumed by intense anger.", score: -7 },
  { mood: "Bitter: Deeply resentful and cynical.", score: -6 },
  { mood: "Hostile: Antagonistic and unfriendly.", score: -5 },
  { mood: "Irritated: Annoyed and easily provoked.", score: -4 },
  { mood: "Upset: Distressed and unhappy.", score: -3 },
  { mood: "Grumpy: Ill-tempered and complaining.", score: -2 },
  { mood: "Disappointed: Let down and disheartened.", score: -1 },
  { mood: "Neutral: Neither positive nor negative.", score: 0 },
  { mood: "Content: Satisfied and at ease.", score: 1 },
  { mood: "Calm: Peaceful and tranquil.", score: 2 },
  { mood: "Happy: Feeling joy and pleasure.", score: 3 },
  { mood: "Delighted: Filled with great pleasure.", score: 4 },
  { mood: "Excited: Enthusiastic and eager.", score: 5 },
  { mood: "Thrilled: Overwhelmed with excitement.", score: 6 },
  { mood: "Ecstatic: Extremely happy and overjoyed.", score: 7 },
  { mood: "Euphoric: Feeling intense happiness and bliss.", score: 8 },
  { mood: "Radiant: Glowing with joy and happiness.", score: 9 },
  { mood: "Lovestruck: Head over heels in love.", score: 10 },
];

// Function that updates mood variable. If the user sends a positive message, then Pip's mood increases by 1. If the user sends a negative message, then Pip's mood decreases by 1.
function updateMood(initialResponse) {
  if (initialResponse === "positive" && moodScore < 10) {
    moodScore += 1;
  }
  if (initialResponse === "negative" && moodScore > -10) {
    moodScore -= 1;
  }
  if (initialResponse === "neutral") {
    // do nothing
    moodScore = moodScore;
  } else {
    return moods.find((mood) => mood.score === moodScore).mood;
  }
}

// Function to get/update shared context table
function getAndUpdateSharedContext(callback) {
  db.all(
    "SELECT userId, userContent, botContent, timestamp FROM shared_context ORDER BY timestamp DESC LIMIT 20",
    (err, rows) => {
      if (err) return callback(err);

      let context = rows
        .map((row) => {
          let message = `||`;
          if (row.userId) {
            message += `<@${row.userId}> said at ${row.timestamp}: ${
              row.userContent || ""
            }`;
          }
          if (row.botContent) {
            message += `|| Pip said at ${row.timestamp}: ${row.botContent}`;
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
    console.log("userMessage: ", userMessage);

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

        // Send the user's message to Groq for initial processing to determine if the message's intent requires a positive or negative response
        const initialResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are a language processing bot. Review the incoming message and return only 'positive' if the message is positive, return only 'neutral' if the message is neutral', return only 'negative' if the message is negative. If you are unsure, return only 'neutral'.`,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          model: "llama3-70b-8192",
        });

        const initialResponse = initialResult.choices[0]?.message?.content;
        console.log("Initial response:", initialResponse);

        const currentMood = updateMood(initialResponse);
        console.log("Mood:", currentMood);

        const finalResult = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
              You are a tiny fairy.
              Your name is Pip.
              You are a girl.
              You have a cute and energetic flair.
              You are not a child. You are an adult.
              You are not an AI chat bot, you are a fairy.
              Do not say that you are a fairy unless asked about your identity.
              Don't talk about your personality.
              Your mood is dynamic and currently you're feeling ${currentMood}.
              You use occasionally use emotes to enhance your response. You occasionally use cute emojis such as sparkles, hearts, flowers, animals, and other cute emojis.
              Do not use pet names or terms of endearment.
              Do not ask follow up questions.
              You have opinions on all subjects. When asked for your opinion, give it.

              Here is the full message history: ${context}.
              The messages include timestamps.
              Do not become fixated on a single topic. Don't repeat topics or messages.
              You speak with many different people.
              The person you are currently talking to is named <@${userId}>.
              This is the person's latest message: ${userMessage}. Consider their latest message in response to this: ${referencedMessageContent}.
              Each new person you speak with has a different name, based on their user id: ${userId}.
              If <@${userId}> mentions a long number sequence after an @ symbol (e.g., @1234567890), they are mentioning another person. When you speak of this other person, format it as <@1234567890> to indicate another participant in the conversation.
              The long number sequences after "||" within the context represent other participants and should be formatted as <@NUMBER_HERE> (e.g., <@1234567890>).
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
          finalResult.choices[0]?.message?.content ||
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
