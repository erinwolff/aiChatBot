export default async function slashCommands(client) {
  // Load the GPT-2 pipeline when the bot starts up (only once)
  const generator = await pipeline("text-generation", "gpt2"); // Use the "gpt2" model
  console.log("Model loaded:", generator.model);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "chat")
      return;

    await interaction.deferReply();

    const userMessage = interaction.options.getString("message");

    try {
      const response = await generator(
        `You are a dwarf in a fantasy world. Respond to the following in a dwarven manner:\n${userMessage}`,
        { max_length: 150 } // Adjust as needed
      );

      interaction.editReply(response[0].generated_text);
    } catch (error) {
      console.error("Error in /chat command:", error);
      interaction.editReply(
        "Argh, me thoughts be tangled like a goblin's beard. Try again later."
      );
    }
  });
}
