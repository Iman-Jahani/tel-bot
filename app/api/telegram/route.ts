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

const D = "━━━━━━━━━━━━━━";

async function setState(telegramId: number, state: string, data: any = {}) {
  await supabase
    .from("admin_states")
    .upsert({ telegram_id: telegramId, state, data, updated_at: new Date().toISOString() });
}
async function getState(telegramId: number) {
  const { data } = await supabase.from("admin_states").select("*").eq("telegram_id", telegramId).maybeSingle();
  return data;
}
async function clearState(telegramId: number) {
  await supabase.from("admin_states").delete().eq("telegram_id", telegramId);
}

async function getEventWithCount(eventId: string) {
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!event) return null;
  const { count } = await supabase
    .from("event_registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);
  return { ...event, registered_count: count ?? 0 };
}

// ---- Menus ----
function mainMenu(admin = false) {
  const kb = new InlineKeyboard()
    .text("📅 ایونت‌ها", "list_events")
    .text("📋 ثبت‌نام‌های من", "my_events")
    .row()
    .text("ℹ️ راهنما", "menu_help");
  if (admin) kb.row().text("👑 پنل ادمین", "menu_admin");
  return kb;
}

function adminMenu() {
  return new InlineKeyboard()
    .text("➕ ایونت جدید", "new_event")
    .text("📊 آمار کلی", "admin_stats")
    .row()
    .text("🗑 حذف ایونت", "admin_delete")
    .row()
    .text("🏠 منوی اصلی", "menu_main");
}

const backMain = () => new InlineKeyboard().text("🏠 منوی اصلی", "menu_main");
const backAdmin = () => new InlineKeyboard().text("↩️ پنل ادمین", "menu_admin");
const cancelBtn = () => new InlineKeyboard().text("❌ لغو", "cancel_create");

// ---- Card ----
function eventCard(e: any) {
  const full = e.capacity > 0 && e.registered_count >= e.capacity;
  const remaining = e.capacity > 0 ? e.capacity - e.registered_count : null;
  const capStr =
    e.capacity > 0
      ? `${e.registered_count}/${e.capacity}${full ? " 🔴 تکمیل" : remaining !== null ? ` (${remaining} جا)` : ""}`
      : `${e.registered_count} (نامحدود)`;

  return (
    `📌 <b>${e.title}</b>\n${D}\n` +
    (e.description ? `📝 ${e.description}\n\n` : "") +
    `🗓 <b>زمان:</b> ${fmtDate(e.event_date)}\n` +
    (e.location ? `📍 <b>مکان:</b> ${e.location}\n` : "") +
    `👥 <b>ظرفیت:</b> ${capStr}`
  );
}

// ---- Global middleware: فرم چندمرحله‌ای ----
bot.on("message:text", async (ctx, next) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return next();
  if (ctx.message.text.startsWith("/")) return next();

  const st = await getState(ctx.from.id);
  if (!st) return next();

  const data = st.data || {};
  const s = st.state;
  const text = ctx.message.text.trim();

  try {
    if (s === "new_event_title") {
      data.title = text;
      await setState(ctx.from.id, "new_event_description", data);
      return ctx.reply("✅ عنوان ثبت شد.\n\n📝 توضیحات رو بفرست (یا «-» برای رد کردن):", { reply_markup: cancelBtn() });
    }
    if (s === "new_event_description") {
      data.description = text === "-" ? null : text;
      await setState(ctx.from.id, "new_event_date", data);
      return ctx.reply("✅ ثبت شد.\n\n🗓 تاریخ و ساعت رو بفرست.\nمثال: <code>2026-05-01 18:30</code>", {
        parse_mode: "HTML",
        reply_markup: cancelBtn(),
      });
    }
    if (s === "new_event_date") {
      const d = new Date(text);
      if (isNaN(d.getTime()))
        return ctx.reply("❌ تاریخ نامعتبره. دوباره بفرست (مثال: 2026-05-01 18:30)", { reply_markup: cancelBtn() });
      data.event_date = d.toISOString();
      await setState(ctx.from.id, "new_event_location", data);
      return ctx.reply("✅ ثبت شد.\n\n📍 مکان رو بفرست (یا «-» برای رد کردن):", { reply_markup: cancelBtn() });
    }
    if (s === "new_event_location") {
      data.location = text === "-" ? null : text;
      await setState(ctx.from.id, "new_event_capacity", data);
      return ctx.reply("✅ ثبت شد.\n\n👥 ظرفیت رو بفرست (عدد). برای نامحدود بنویس <code>0</code>:", {
        parse_mode: "HTML",
        reply_markup: cancelBtn(),
      });
    }
    if (s === "new_event_capacity") {
      const cap = parseInt(text, 10);
      if (isNaN(cap) || cap < 0) return ctx.reply("❌ عدد نامعتبره. دوباره بفرست:", { reply_markup: cancelBtn() });
      data.capacity = cap;

      const { data: ins, error } = await supabase
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
        return ctx.reply("❌ خطا: " + error.message);
      }
      const full = await getEventWithCount(ins.id);
      return ctx.reply(`🎉 <b>ایونت ساخته شد!</b>\n\n${eventCard(full)}`, {
        parse_mode: "HTML",
        reply_markup: backAdmin(),
      });
    }
  } catch (e: any) {
    console.error(e);
    return ctx.reply("❌ خطا: " + (e?.message ?? "unknown"));
  }
  return next();
});

// ---- List events (shared) ----
async function sendEventList(ctx: any, edit = false) {
  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .order("event_date", { ascending: true });

  if (error) return ctx.reply("❌ خطا: " + error.message);
  if (!events || events.length === 0) {
    const msg = "📭 هنوز هیچ ایونتی نیست.\nادمین می‌تونه از پنل، ایونت بسازه.";
    return edit
      ? ctx.editMessageText(msg, { reply_markup: backMain() })
      : ctx.reply(msg, { reply_markup: backMain() });
  }

  for (const ev of events) {
    const full = await getEventWithCount(ev.id);
    const isFull = full!.capacity > 0 && full!.registered_count >= full!.capacity;
    const kb = new InlineKeyboard();
    if (isFull) kb.text("🔴 ظرفیت تکمیل", "noop");
    else kb.text("✍️ ثبت‌نام", `reg_${ev.id}`);
    kb.row().text("🏠 منوی اصلی", "menu_main");
    await ctx.reply(eventCard(full), { parse_mode: "HTML", reply_markup: kb });
  }
}

// ---- Callbacks ----
bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery({ text: "ظرفیت تکمیل شده ❌" }));

bot.callbackQuery("menu_main", async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from ? isAdmin(ctx.from.id) : false;
  await ctx.editMessageText(
    `🏠 <b>منوی اصلی</b>\n${D}\n\nاز گزینه‌های زیر انتخاب کن:`,
    { parse_mode: "HTML", reply_markup: mainMenu(admin) }
  ).catch(() => ctx.reply("منوی اصلی", { reply_markup: mainMenu(admin) }));
});

bot.callbackQuery("menu_help", async (ctx) => {
  await ctx.answerCallbackQuery();
  const txt =
    `ℹ️ <b>راهنما</b>\n${D}\n\n` +
    `📅 <b>ایونت‌ها</b> — دیدن ایونت‌های فعال\n` +
    `📋 <b>ثبت‌نام‌های من</b> — ایونت‌هایی که ثبت‌نام کردی\n\n` +
    `👑 <b>دستورات ادمین:</b>\n` +
    `/admin — پنل ادمین\n` +
    `/new_event — ساخت ایونت\n` +
    `/cancel — لغو فرم در جریان`;
  await ctx.editMessageText(txt, { parse_mode: "HTML", reply_markup: backMain() }).catch(() =>
    ctx.reply(txt, { parse_mode: "HTML", reply_markup: backMain() })
  );
});

bot.callbackQuery("menu_admin", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  await ctx.editMessageText(
    `👑 <b>پنل ادمین</b>\n${D}\n\nیه گزینه انتخاب کن:`,
    { parse_mode: "HTML", reply_markup: adminMenu() }
  ).catch(() => ctx.reply("پنل ادمین", { reply_markup: adminMenu() }));
});

bot.callbackQuery("list_events", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendEventList(ctx);
});

bot.callbackQuery("my_events", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;

  const { data, error } = await supabase
    .from("event_registrations")
    .select("event_id, events(id, title, event_date, location)")
    .eq("telegram_id", ctx.from.id);

  if (error) return ctx.reply("❌ " + error.message);
  if (!data || data.length === 0) {
    return ctx.editMessageText(
      "📭 هنوز توی هیچ ایونتی ثبت‌نام نکردی.",
      { reply_markup: backMain() }
    ).catch(() => ctx.reply("📭 هنوز توی هیچ ایونتی ثبت‌نام نکردی."));
  }

  await ctx.editMessageText(`📋 <b>ثبت‌نام‌های تو (${data.length})</b>\n${D}`, {
    parse_mode: "HTML",
    reply_markup: backMain(),
  }).catch(() => {});

  for (const r of data as any[]) {
    const ev = r.events;
    if (!ev) continue;
    const kb = new InlineKeyboard().text("❌ لغو ثبت‌نام", `unreg_${ev.id}`).row().text("🏠 منوی اصلی", "menu_main");
    await ctx.reply(
      `📌 <b>${ev.title}</b>\n${D}\n🗓 ${fmtDate(ev.event_date)}${ev.location ? `\n📍 ${ev.location}` : ""}`,
      { parse_mode: "HTML", reply_markup: kb }
    );
  }
});

// ثبت‌نام
bot.callbackQuery(/^reg_(.+)$/, async (ctx) => {
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
    if (error.code === "23505") return ctx.reply("ℹ️ قبلاً توی این ایونت ثبت‌نام کردی.");
    return ctx.reply("❌ خطا: " + error.message);
  }
  return ctx.reply(`✅ <b>ثبت‌نام موفق!</b>\n\n📌 ${full.title}`, { parse_mode: "HTML" });
});

// لغو ثبت‌نام
bot.callbackQuery(/^unreg_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;
  const eventId = ctx.match![1];
  const { error } = await supabase
    .from("event_registrations")
    .delete()
    .eq("event_id", eventId)
    .eq("telegram_id", ctx.from.id);
  if (error) return ctx.reply("❌ " + error.message);
  return ctx.reply("✅ ثبت‌نام لغو شد.");
});

// پنل ادمین — شروع ساخت ایونت
bot.callbackQuery("new_event", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  await clearState(ctx.from.id);
  await setState(ctx.from.id, "new_event_title", {});
  await ctx.reply("📝 <b>مرحله 1/5 — عنوان</b>\n\nعنوان ایونت رو بفرست:", {
    parse_mode: "HTML",
    reply_markup: cancelBtn(),
  });
});

bot.callbackQuery("cancel_create", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;
  await clearState(ctx.from.id);
  await ctx.reply("❌ ساخت ایونت لغو شد.", { reply_markup: adminMenu() });
});

// آمار
bot.callbackQuery("admin_stats", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;

  const { count: evCount } = await supabase.from("events").select("*", { count: "exact", head: true });
  const { count: regCount } = await supabase.from("event_registrations").select("*", { count: "exact", head: true });
  const { data: recent } = await supabase
    .from("event_registrations")
    .select("registered_at")
    .gte("registered_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

  const txt =
    `📊 <b>آمار کلی</b>\n${D}\n\n` +
    `📅 تعداد ایونت‌ها: <b>${evCount ?? 0}</b>\n` +
    `👥 کل ثبت‌نام‌ها: <b>${regCount ?? 0}</b>\n` +
    `🔥 ثبت‌نام‌های ۷ روز اخیر: <b>${recent?.length ?? 0}</b>`;

  await ctx.editMessageText(txt, { parse_mode: "HTML", reply_markup: backAdmin() }).catch(() =>
    ctx.reply(txt, { parse_mode: "HTML", reply_markup: backAdmin() })
  );
});

// لیست حذف
bot.callbackQuery("admin_delete", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;

  const { data: events } = await supabase.from("events").select("id, title, event_date").order("event_date", { ascending: true });
  if (!events || events.length === 0) {
    return ctx.editMessageText("📭 ایونتی برای حذف نیست.", { reply_markup: backAdmin() }).catch(() => ctx.reply("📭 ایونتی نیست."));
  }

  await ctx.editMessageText(`🗑 <b>حذف ایونت</b>\n${D}\n\nروی ایونت بزن تا حذف شه:`, {
    parse_mode: "HTML",
    reply_markup: backAdmin(),
  }).catch(() => {});

  for (const ev of events) {
    const kb = new InlineKeyboard().text(`❌ حذف: ${ev.title.slice(0, 25)}`, `del_${ev.id}`);
    await ctx.reply(`📌 <b>${ev.title}</b>\n🗓 ${fmtDate(ev.event_date)}`, { parse_mode: "HTML", reply_markup: kb });
  }
});

// حذف ایونت
bot.callbackQuery(/^del_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  const id = ctx.match![1];
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return ctx.reply("❌ " + error.message);
  return ctx.editMessageText("✅ ایونت حذف شد.", { reply_markup: backAdmin() }).catch(() => ctx.reply("✅ حذف شد."));
});

// ---- Commands ----
bot.command("start", async (ctx) => {
  const admin = ctx.from ? isAdmin(ctx.from.id) : false;
  const name = ctx.from?.first_name ?? "دوست عزیز";
  const txt =
    `👋 سلام <b>${name}</b>!\n${D}\n\n` +
    `به ربات <b>ثبت‌نام ایونت</b> خوش اومدی 🎉\n\n` +
    `از منوی زیر انتخاب کن:`;
  await ctx.reply(txt, { parse_mode: "HTML", reply_markup: mainMenu(admin) });
});

bot.command("menu", (ctx) => {
  const admin = ctx.from ? isAdmin(ctx.from.id) : false;
  return ctx.reply("🏠 منوی اصلی", { reply_markup: mainMenu(admin) });
});

bot.command("events", (ctx) => sendEventList(ctx));
bot.command("myevents", async (ctx) => {
  // reuse callback logic
  if (!ctx.from) return;
  const { data } = await supabase
    .from("event_registrations")
    .select("event_id, events(id, title, event_date)")
    .eq("telegram_id", ctx.from.id);
  if (!data || data.length === 0) return ctx.reply("📭 هنوز ثبت‌نام نکردی.");
  let msg = `📋 <b>ثبت‌نام‌های تو (${data.length})</b>\n${D}\n\n`;
  (data as any[]).forEach((r, i) => {
    if (r.events) msg += `${i + 1}. <b>${r.events.title}</b> — ${fmtDate(r.events.event_date)}\n`;
  });
  await ctx.reply(msg, { parse_mode: "HTML", reply_markup: backMain() });
});

bot.command("admin", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) return ctx.reply("⛔ دسترسی نداری.");
  await ctx.reply(`👑 <b>پنل ادمین</b>\n${D}`, { parse_mode: "HTML", reply_markup: adminMenu() });
});

bot.command("cancel", async (ctx) => {
  if (!ctx.from) return;
  await clearState(ctx.from.id);
  await ctx.reply("✅ لغو شد.", { reply_markup: mainMenu(isAdmin(ctx.from.id)) });
});

// ---- Webhook ----
export const POST = webhookCallback(bot, "std/http");