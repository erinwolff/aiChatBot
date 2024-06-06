import Discord from "discord.js";
import config from "./config.json" assert { type: "json" };
import errorHandler from "./src/error.js";
import { ActivityType } from "discord.js";
import messageHandler from "./src/messageHandler.js";

async function aiChatBot() {
  const client = new Discord.Client({
    intents: [
      "Guilds", // Allows the bot to receive information about the guilds (servers) it is in
      "GuildMessages", // Allows the bot to receive messages in a guild
      "MessageContent", // Allows the bot to receive message content
    ],
  });

  // success message once client is logged in
  client.on("ready", () => {
    // to set the bot's username
    // try {
    //   await client.user.setUsername("Pip");
    // } catch {
    //   console.log("Error setting username");
    // }

    // Set custom message and presence status
    try {
      client.user.setPresence({
        activities: [{ name: `being cute`, type: ActivityType.Custom }], // Activity types: Competing, Custom, Listening, Playing, Streaming, Watching
        status: "online",
      });
      console.log("Activity set successfully");
    } catch (error) {
      console.error("Error setting activity:", error);
    }
    console.log(`Logged in as ${client.user.tag}!`);
    // Function to handle chat messages incoming from Discord user
    messageHandler(client);
  });

  //error handler
  errorHandler();

  client.login(config.token);
}
aiChatBot();
