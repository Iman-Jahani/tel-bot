import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { createClient } from "@supabase/supabase-js";

// ---- Env ----
const token = process.env.BOT_TOKEN!;
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminIds = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n !== 0);

if (!token) throw new Error("BOT_TOKEN is unset");
if (!supabaseUrl || !supabaseKey)
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset");

// ---- Clients ----
const bot = new Bot(token);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---- Helpers ----
const isAdmin = (id: number) => adminIds.includes(id);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("fa-IR", {
    dateStyle: "full",
    timeStyle: "short",
  });

async function setState(telegramId: number, state: string, data: any = {}) {
  await supabase.from("admin_states").upsert({
    telegram_id: telegramId,
    state,
    data,
    updated_at: new Date().toISOString(),
  });
}

async function getState(telegramId: number) {
  const { data } = await supabase
    .from("admin_states")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data;
}

async function clearState(telegramId: number) {
  await supabase.from("admin_states").delete().eq("telegram_id", telegramId);
}

async function getEventWithCount(eventId: string) {
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  const { count } = await supabase
    .from("event_registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);
  return { ...event, registered_count: count ?? 0 };
}

function eventCard(event: any) {
  const capacity =
    event.capacity > 0
      ? `${event.registered_count}/${event.capacity}`
      : `${event.registered_count} (نامحدود)`;
  return (
    `📅 <b>${event.title}</b>\n\n` +
    (event.description ? `${event.description}\n\n` : "") +
    `🗓 زمان: ${fmtDate(event.event_date)}\n` +
    (event.location ? `📍 مکان: ${event.location}\n` : "") +
    `👥 ظرفیت: ${capacity}`
  );
}

// ---- Middleware: فرم چندمرحله‌ای ساخت ایونت ----
bot.on("message:text", async (ctx, next) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return next();
  if (ctx.message.text.startsWith("/")) return next();

  const state = await getState(ctx.from.id);
  if (!state) return next();

  const data = state.data || {};
  const s = state.state;
  const text = ctx.message.text.trim();

  try {
    if (s === "new_event_title") {
      data.title = text;
      await setState(ctx.from.id, "new_event_description", data);
      return ctx.reply(
        "✅ عنوان ذخیره شد.\n\n📝 توضیحات ایونت رو بفرست (یا «-» برای رد کردن):"
      );
    }

    if (s === "new_event_description") {
      data.description = text === "-" ? null : text;
      await setState(ctx.from.id, "new_event_date", data);
      return ctx.reply(
        "✅ ذخیره شد.\n\n🗓 تاریخ و ساعت رو بفرست.\nمثال: 2026-05-01 18:30"
      );
    }

    if (s === "new_event_date") {
      const d = new Date(text);
      if (isNaN(d.getTime())) {
        return ctx.reply(
          "❌ تاریخ نامعتبره. دوباره بفرست (مثال: 2026-05-01 18:30)"
        );
      }
      data.event_date = d.toISOString();
      await setState(ctx.from.id, "new_event_location", data);
      return ctx.reply(
        "✅ ذخیره شد.\n\n📍 مکان رو بفرست (یا «-» برای رد کردن):"
      );
    }

    if (s === "new_event_location") {
      data.location = text === "-" ? null : text;
      await setState(ctx.from.id, "new_event_capacity", data);
      return ctx.reply(
        "✅ ذخیره شد.\n\n👥 ظرفیت رو بفرست (عدد). برای نامحدود بنویس 0:"
      );
    }

    if (s === "new_event_capacity") {
      const cap = parseInt(text, 10);
      if (isNaN(cap) || cap < 0) {
        return ctx.reply("❌ عدد نامعتبره. دوباره بفرست:");
      }
      data.capacity = cap;

      const { data: inserted, error } = await supabase
        .from("events")
        .insert({
          title: data.title,
          description: data.description,
          event_date: data.event_date,
          location: data.location,
          capacity: cap,
          created_by: ctx.from.id,
        })
        .select()
        .single();

      await clearState(ctx.from.id);

      if (error) {
        console.error(error);
        return ctx.reply("❌ خطا در ذخیره: " + error.message);
      }

      const full = await getEventWithCount(inserted.id);
      return ctx.reply("🎉 ایونت ساخته شد!\n\n" + eventCard(full), {
        parse_mode: "HTML",
      });
    }
  } catch (e: any) {
    console.error(e);
    return ctx.reply("❌ خطا: " + (e?.message ?? "unknown"));
  }

  return next();
});

// ---- لیست ایونت‌ها ----
async function listEvents(ctx: any) {
  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .order("event_date", { ascending: true });

  if (error) return ctx.reply("❌ خطا: " + error.message);
  if (!events || events.length === 0)
    return ctx.reply("هیچ ایونتی موجود نیست.");

  for (const ev of events) {
    const full = await getEventWithCount(ev.id);
    const kb = new InlineKeyboard().text("✍️ ثبت‌نام", `register_${ev.id}`);
    await ctx.reply(eventCard(full), {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  }
}

// ---- Commands ----
bot.command("start", async (ctx) => {
  const kb = new InlineKeyboard().text("📅 دیدن ایونت‌ها", "list_events");
  await ctx.reply("سلام 👋\nبرای دیدن ایونت‌ها روی دکمه زیر بزن:", {
    reply_markup: kb,
  });
});

bot.command("events", (ctx) => listEvents(ctx));

bot.command("myevents", async (ctx) => {
  if (!ctx.from) return;
  const { data, error } = await supabase
    .from("event_registrations")
    .select("event_id, events(title, event_date)")
    .eq("telegram_id", ctx.from.id);

  if (error) return ctx.reply("❌ خطا: " + error.message);
  if (!data || data.length === 0)
    return ctx.reply("هنوز توی هیچ ایونتی ثبت‌نام نکردی.");

  let msg = "📋 ایونت‌های ثبت‌نام‌شده:\n\n";
  data.forEach((r: any, i: number) => {
    msg += `${i + 1}. ${r.events.title} — ${fmtDate(r.events.event_date)}\n`;
  });
  return ctx.reply(msg);
});

bot.command("new_event", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id))
    return ctx.reply("⛔ فقط ادمین می‌تونه ایونت بسازه.");
  await clearState(ctx.from.id);
  await setState(ctx.from.id, "new_event_title", {});
  await ctx.reply("📝 عنوان ایونت رو بفرست:");
});

bot.command("cancel", async (ctx) => {
  if (!ctx.from) return;
  await clearState(ctx.from.id);
  await ctx.reply("✅ لغو شد.");
});

bot.command("admin", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id))
    return ctx.reply("⛔ دسترسی نداری.");
  await ctx.reply(
    "🛠 دستورات ادمین:\n\n" +
      "/new_event — ساخت ایونت جدید\n" +
      "/cancel — لغو فرم در جریان\n" +
      "/allevent — لیست همه با آمار\n" +
      "/delevent <id> — حذف ایونت"
  );
});

bot.command("allevent", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id))
    return ctx.reply("⛔ دسترسی نداری.");

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: true });

  if (!events || events.length === 0) return ctx.reply("هیچ ایونتی نیست.");

  let msg = "📊 همه ایونت‌ها:\n\n";
  for (const ev of events) {
    const full = await getEventWithCount(ev.id);
    msg += `• ${ev.title} — ${ev.id}\n  ثبت‌نام: ${full.registered_count}${
      ev.capacity > 0 ? "/" + ev.capacity : ""
    }\n\n`;
  }
  return ctx.reply(msg);
});

bot.command("delevent", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id))
    return ctx.reply("⛔ دسترسی نداری.");
  const id = ctx.match?.toString().trim();
  if (!id) return ctx.reply("استفاده: /delevent <id>");
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return ctx.reply("❌ " + error.message);
  return ctx.reply("✅ حذف شد.");
});

// ---- Callbacks ----
bot.callbackQuery("list_events", async (ctx) => {
  await ctx.answerCallbackQuery();
  await listEvents(ctx);
});

bot.callbackQuery(/^register_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;

  const eventId = ctx.match![1];

  const full = await getEventWithCount(eventId);
  if (!full) return ctx.reply("❌ ایونت پیدا نشد.");
  if (!full.is_active) return ctx.reply("❌ این ایونت غیرفعاله.");
  if (full.capacity > 0 && full.registered_count >= full.capacity)
    return ctx.reply("❌ ظرفیت تکمیل شده.");

  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    telegram_id: ctx.from.id,
    first_name: ctx.from.first_name,
    username: ctx.from.username ?? null,
  });

  if (error) {
    if (error.code === "23505")
      return ctx.reply("ℹ️ قبلاً توی این ایونت ثبت‌نام کردی.");
    return ctx.reply("❌ خطا: " + error.message);
  }

  return ctx.reply(`✅ ثبت‌نام موفق در «${full.title}»!`);
});

// ---- Webhook ----
export const POST = webhookCallback(bot, "std/http");