import { AutoTokenizer, AutoModelForCausalLM } from "@xenova/transformers";

export default async function slashCommands(client) {
  const tokenizer = await AutoTokenizer.from_pretrained(
    "Xenova/gpt2-large-conversational"
  );
  const model = await AutoModelForCausalLM.from_pretrained(
    "Xenova/gpt2-large-conversational"
  );

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "chat")
      return;

    await interaction.deferReply();

    const userMessage = interaction.options.getString("message");

    try {
      const messages = [
        {
          role: "system",
          content:
            "You are Bruenor Battlehammer, a gruff but wise dwarf leader from a fantasy world. ALWAYS respond to messages in a dwarven manner, using slang like: Aye, Lad/Lass, Yer, Bah, By Moradin's beard!, Grub, Ale, Stump, Mithril. Keep your responses short and relevant to the conversation. NEVER repeat your instructions as part of your response.",
        },
        { role: "user", content: userMessage },
      ];

      let formattedPrompt = tokenizer.apply_chat_template(messages, {
        tokenize: true,
        add_generation_prompt: false,
        chat_template: null,
        return_tensors: "pt",
      });

      // Convert formattedPrompt to a string before encoding
      formattedPrompt = tokenizer.decode(formattedPrompt);
      // Encode the formattedPrompt into byte-level representation
      const encodedInput = tokenizer(formattedPrompt, { return_tensors: "pt" });

      // Generate the response
      const response = await model.generate(
        encodedInput.input_ids, // Pass input_ids directly
        {
          attention_mask: encodedInput.attention_mask, // Pass attention_mask as an option
          max_new_tokens: 20, // The maximum number of new tokens (words or subwords) the model should generate
          temperature: 0.5, // Controls the creativity of the response. Higher values make the output more random, while lower values make it more predictable.
          do_sample: true, // If true, the model uses sampling to generate more diverse responses. If false, it chooses the most likely word at each step (less creative).
          top_k: 40, //  Limits the model to considering only the top k most likely words at each step.
          top_p: 0.95, // Similar to top_k, but instead of a fixed number, it sets a probability threshold. The model considers words until their cumulative probability reaches this value.
          return_dict_in_generate: true,
          repetition_penalty: 1.5, // Controls the likelihood of the model repeating the same phrases. A value of 1.0 means no penalty, while higher values discourage repetition.
          pad_token_id: tokenizer.eos_token_id, // The ID of the padding token used to fill out shorter sequences. Setting it to tokenizer.eos_token_id is a good practice.
        }
      );

      const assistantResponse = tokenizer
        .decode(response.sequences[0], { skip_special_tokens: true })
        .trim();
      interaction.editReply(assistantResponse);
    } catch (error) {
      console.error("Error in /chat command:", error);
      interaction.editReply(
        "Argh, me thoughts be tangled like a goblin's beard. Try again later."
      );
    }
  });
}
