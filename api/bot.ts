import { Bot, webhookCallback } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is unset");

const bot = new Bot(token);

bot.command("start", (ctx) =>
  ctx.reply("سلام! ربات من روی Vercel کار می‌کند. 🎉")
);

bot.on("message", (ctx) =>
  ctx.reply(`پیام شما: ${ctx.message.text}`)
);

export default webhookCallback(bot, "https");