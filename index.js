import Discord from "discord.js";
import { Ollama } from "ollama";
import config from "./config.json" assert { type: "json" };
import errorHandler from "./src/error.js";
import { ActivityType } from "discord.js";

async function bruenorBattlehammer() {
  const ollama = new Ollama({ model: "tinyllama" });
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
    console.log("Bruenor is online and ready to crack some skulls!");

    // Set custom message and presence status
    try {
      client.user.setPresence({
        activities: [
          { name: `killing stinkin orcs`, type: ActivityType.Custom },
        ], // Activity types: Competing, Custom, Listening, Playing, Streaming, Watching
        status: "online",
      });
      console.log("Activity set successfully");
    } catch (error) {
      console.error("Error setting activity:", error);
    }
  });

  client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
  });

  client.on("message", async (message) => {
    if (message.author.bot || !message.content.startsWith("!dwarf")) return;

    const prompt = message.content.slice(6); // Remove "!dwarf "

    const response = await ollama.generate({
      prompt: `You are a dwarf in a fantasy world. Respond to the following in a dwarven manner:\n${prompt}`,
    });

    message.reply(response.text);
  });

  //error handler
  errorHandler();

  client.login(config.token);
}
bruenorBattlehammer();
