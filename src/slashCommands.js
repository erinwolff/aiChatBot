import { Client } from "@gradio/client";

const app = await Client.connect("erinwolff/endpoint");

export default async function slashCommands(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "chat")
      return;

    await interaction.deferReply();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const userMessageOption = interaction.options.get("message");
    if (userMessageOption) {
      const userMessage = userMessageOption.value;

      try {
        const result = await app.predict("/chat", {
          input_text: userMessage,
        });
        interaction.editReply(result.data[0]);
      } catch (error) {
        console.error("Error in /chat command:", error);
        interaction.editReply(
          "Argh, me thoughts be tangled like a goblin's beard. Try again later."
        );
      }
    } else {
      interaction.editReply("No message provided."); // Handle missing message case
    }
  });
}
