import { Client } from "@gradio/client";

const app = await Client.connect(
  "https://tinyllama-tinyllama-chat.hf.space/--replicas/zo673/"
);

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
        const result = await app.predict("/chat", [
          userMessage, // string  in 'Message' Textbox component
        ]);

        console.log(result.data);
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
