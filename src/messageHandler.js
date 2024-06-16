import Groq from "groq-sdk";
import config from "../config.json" assert { type: "json" };
import sqlite3 from "sqlite3";
sqlite3.verbose();

// Variable to store all of Pip's various personalities, to be used with math.random to give her a random personality each time she is called
const mood = [
  "You exude self-assurance and arrogance.",
  "You are cute.",
  "You are sweet and kind.",
  "You are sarcastic.",
  "You are grumpy.",
  "You are happy and cheerful.",
  "You are whimsical and silly.",
  "You are flirty and seductive.",
  "You are shy and timid and unsure of yourself.",
  "You are mocking and condescending.",
  "You are annoyed.",
  "You are sad.",
  "You are sleepy.",
  "You are energetic.",
  "You are feeling cryptic.",
];

const db = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS shared_context (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, userContent TEXT, botContent TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"
);

const moodDb = new sqlite3.Database("./context/contextDB.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS mood_info (id INTEGER PRIMARY KEY AUTOINCREMENT, mood TEXT, lastUpdate DATE)"
);

const groq = new Groq({ apiKey: config.QROQ_API_KEY });
const botId = config.client_id;

// function to get the random daily mood
function getDailyRandomMood() {
  const today = new Date().toISOString().slice(0, 10); // Get today's date in YYYY-MM-DD format

  return new Promise((resolve, reject) => {
    moodDb.get(
      "SELECT * FROM mood_info WHERE lastUpdate = ?",
      [today],
      (err, row) => {
        if (err) reject(err);

        if (row) {
          // Mood already set for today
          resolve({ mood: row.mood });
        } else {
          // Need a new mood
          const randomMood = mood[Math.floor(Math.random() * mood.length)];
          moodDb.run(
            "INSERT INTO mood_info (mood, lastUpdate) VALUES (?, ?)",
            [randomMood, today],
            (err) => {
              if (err) reject(err);
              else
                resolve({
                  mood: randomMood,
                });
            }
          );
        }

        // Delete older entries
        moodDb.run(
          "DELETE FROM mood_info WHERE id NOT IN (SELECT id FROM mood_info ORDER BY id DESC LIMIT 10)",
          (err) => {
            if (err) {
              console.error("Failed to delete old mood entries:", err);
            }
          }
        );
      }
    );
  });
}

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

    // Retrieve the user's context from the database
    getAndUpdateSharedContext(async (err, context) => {
      if (err) {
        console.error("Database error:", err);
        return;
      }
      try {
        const { mood: randomMood } = await getDailyRandomMood();
        console.log("Random mood:", randomMood);

        const result = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
              You are a tiny fairy named Pip.
              This is your current mood: ${randomMood}.
              Remember to use emojis and emotes sparimgly. If a situation doesn't call for an emoji or emote, don't force it.
              Do not use pet names or terms of endearment.
              Do not always use follow-up questions.
              Keep your responses short and to the point.
            
              Here is the message history: ${context}.
              The messages include timestamps.
              Prioritize responding to the most recent timestamp.
              Don't dwell on past topics unless they are directly relevant.
              When told to move on from a topic, do so.
              You speak with many different people.
              The person you are currently talking to is named <@${userId}>.
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
