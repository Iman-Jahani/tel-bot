import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { createClient } from "@supabase/supabase-js";


// ---- Env ----
const token = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!token) throw new Error("BOT_TOKEN is unset");
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset");
}

// ---- Clients ----
const bot = new Bot(token);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---- Helpers ----
async function registerUser(from: {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
}) {
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        telegram_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name,
        last_name: from.last_name ?? null,
        language_code: from.language_code ?? null,
      },
      { onConflict: "telegram_id" }
    )
    .select()
    .single();

  return { data, error };
}

// ---- Commands ----
bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("📝 ثبت‌نام", "register")
    .row()
    .text("👤 پروفایل من", "profile");

  await ctx.reply("سلام 👋\nبرای ثبت‌نام روی دکمه‌ی زیر بزن:", {
    reply_markup: kb,
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "دستورات:\n/start - شروع و ثبت‌نام\n/count - تعداد کاربران"
  );
});

bot.command("count", async (ctx) => {
  const { count, error } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  if (error) {
    await ctx.reply("❌ خطا: " + error.message);
    return;
  }
  await ctx.reply(`👥 تعداد کاربران: ${count}`);
});

// ---- Callbacks ----
bot.callbackQuery("register", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return ctx.reply("❌ کاربر پیدا نشد.");

  const { data, error } = await registerUser(ctx.from);
  if (error) {
    console.error("register error:", error);
    return ctx.reply("❌ خطا: " + error.message);
  }

  await ctx.reply(
    `✅ ثبت‌نام موفق!\n\n👤 ${data.first_name}\n🆔 <code>${data.telegram_id}</code>\n📅 ${new Date(data.registered_at).toLocaleString("fa-IR")}`,
    { parse_mode: "HTML" }
  );
});

bot.callbackQuery("profile", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", ctx.from.id)
    .maybeSingle();

  if (error) return ctx.reply("❌ خطا: " + error.message);
  if (!data) return ctx.reply("هنوز ثبت‌نام نکردی. /start رو بزن.");

  await ctx.reply(
    `👤 پروفایل:\n\nنام: ${data.first_name} ${data.last_name ?? ""}\nیوزرنیم: ${data.username ? "@" + data.username : "—"}\n🆔 <code>${data.telegram_id}</code>\n📅 ${new Date(data.registered_at).toLocaleString("fa-IR")}`,
    { parse_mode: "HTML" }
  );
});

// ---- Webhook (نکته‌ی کلیدی) ----
export const POST = webhookCallback(bot, "std/http");