import Discord from "discord.js";
import config from "./config.json" assert { type: "json" };
import errorHandler from "./src/error.js";
import { ActivityType } from "discord.js";
import slashCommands from "./src/slashCommands.js";

async function bruenorBattlehammer() {
  const client = new Discord.Client({
    intents: [
      "Guilds", // Allows the bot to receive information about the guilds (servers) it is in
      "GuildMessages", // Allows the bot to receive messages in a guild
      "MessageContent", // Allows the bot to receive message content
    ],
  });

  // success message once client is logged in
  client.on("ready", (c) => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Set custom message and presence status
    try {
      client.user.setPresence({
        activities: [{ name: `eating grass`, type: ActivityType.Custom }], // Activity types: Competing, Custom, Listening, Playing, Streaming, Watching
        status: "online",
      });
      console.log("Activity set successfully");
    } catch (error) {
      console.error("Error setting activity:", error);
    }
    // Function to handle slash commands incoming from Discord (interaction)
    slashCommands(client);
  });

  client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
  });

  //error handler
  errorHandler();

  client.login(config.token);
}
bruenorBattlehammer();
