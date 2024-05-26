import { Ollama } from "ollama";

export default async function slashCommands(client) {
  const ollama = new Ollama({ baseUrl: "http://localhost:11434" });
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "chat")
      return;

    await interaction.deferReply();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const userMessageOption = interaction.options.get("message");
    if (userMessageOption) {
      const userMessage = userMessageOption.value;

      try {
        const stream = await ollama.generate({
          model: "tinyllama:1.1b",
          prompt: `You are a chat bot and you speak like a dwarf. Your name is Bruenor Battlehammer.\n ${userMessage}`,
          max_tokens: 50,
          temperature: 0.4,
        });

        console.log("stream", stream);
        const assistantResponse = stream.response;

        interaction.editReply(assistantResponse);
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
