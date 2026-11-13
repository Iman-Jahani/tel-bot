// api/bot.ts
import { Bot, webhookCallback } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is unset");

const bot = new Bot(token);

// یک هندلر ساده برای دستور /start
bot.command("start", (ctx) => ctx.reply("سلام! ربات من روی Vercel کار می‌کند."));

// تبدیل ربات به یک Webhook Handler برای Vercel
export default webhookCallback(bot, "https");