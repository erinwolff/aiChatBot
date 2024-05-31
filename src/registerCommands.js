import { REST, Routes } from "discord.js";
import config from "../config.json" assert { type: "json" };

// Define your slash commands
const commands = [
  {
    name: "chat",
    description: "Say something to the bot!",
    options: [
      {
        name: "message",
        description: "Your message to the bot.",
        type: 3, // Type 3 is for string input
        required: true,
      },
    ],
  },
  // Add other commands as needed
];

// Set up REST for deploying commands
const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationGuildCommands(config.client_id, config.guild_id),
      { body: commands }
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
