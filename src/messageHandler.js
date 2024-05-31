import { Client } from "@gradio/client";
import config from "../config.json" assert { type: "json" };

const app = await Client.connect("erinwolff/endpoint");
const botId = config.client_id;

export default async function messageHandler(client) {
  client.on("messageCreate", async (message) => {
    if (!message.mentions.has(botId)) return;

    const userMessage = message.content.replace(`<@${botId}>`, "").trim();

    try {
      const result = await app.predict("/chat", {
        input_text: userMessage,
      });
      message.reply(result.data[0]);
    } catch (error) {
      console.error("Error in /chat command:", error);
      message.reply(
        "Argh, me thoughts be tangled like a goblin's beard. Try again later."
      );
    }
  });
}
