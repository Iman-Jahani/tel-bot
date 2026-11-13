
import { Bot, webhookCallback } from "grammy";

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is not configured");
}

const bot = new Bot(token);

bot.command("start", (ctx) =>
  ctx.reply("سلام! ربات من روی Vercel کار می‌کند. 🎉")
);

bot.on("message:text", (ctx) =>
  ctx.reply(`پیام شما: ${ctx.message.text}`)
);

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: process.env.WEBHOOK_SECRET,
  timeoutMilliseconds: 9000,
});

export async function POST(request: Request) {
  return handleUpdate(request);
}
