
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

const token = process.env.BOT_TOKEN!;
const webhookSecret = process.env.WEBHOOK_SECRET!;
const adminId = process.env.ADMIN_TELEGRAM_ID!;

if (!token || !webhookSecret || !adminId) {
  throw new Error("Bot environment variables are missing");
}

const bot = new Bot(token);

type EventData = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  location: string;
  capacity: number | null;
  is_active: boolean;
};

type UserState = {
  state: string;
  data: Record<string, any>;
};

async function getState(userId: string): Promise<UserState | null> {
  const { data } = await supabase
    .from("user_states")
    .select("*")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  return data
    ? { state: data.state, data: data.data || {} }
    : null;
}

async function setState(
  userId: string,
  state: string,
  data: Record<string, any> = {}
) {
  const { error } = await supabase
    .from("user_states")
    .upsert({
      telegram_user_id: userId,
      state,
      data,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
}

async function clearState(userId: string) {
  const { error } = await supabase
    .from("user_states")
    .delete()
    .eq("telegram_user_id", userId);

  if (error) throw error;
}

function isAdmin(userId: string) {
  return userId === adminId;
}

function mainMenu(isAdminUser: boolean) {
  const keyboard = new InlineKeyboard()
    .text("📅 مشاهده رویدادها", "events")
    .row()
    .text("📋 ثبت‌نام‌های من", "my-registrations")
    .row()
    .text("👤 راهنمای ثبت‌نام", "help");

  if (isAdminUser) {
    keyboard.row().text("⚙️ مدیریت رویدادها", "admin");
  }

  return keyboard;
}

async function showMainMenu(ctx: any) {
  const admin = isAdmin(String(ctx.from.id));

  await ctx.reply(
    "سلام و خوش آمدید! 👋\n\n" +
    "به سامانه ثبت‌نام رویدادها خوش آمدید.\n\n" +
    "از منوی زیر می‌توانید رویدادهای موجود را مشاهده کنید و در آن‌ها ثبت‌نام کنید.",
    {
      reply_markup: mainMenu(admin),
    }
  );
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("fa-IR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  });
}

// -----------------------------
// Start
// -----------------------------

bot.command("start", async (ctx) => {
  await clearState(String(ctx.from.id));
  await showMainMenu(ctx);
});

bot.command("cancel", async (ctx) => {
  await clearState(String(ctx.from.id));
  await ctx.reply("عملیات لغو شد.", {
    reply_markup: mainMenu(isAdmin(String(ctx.from.id))),
  });
});

// -----------------------------
// Main menu callbacks
// -----------------------------

bot.callbackQuery("menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMainMenu(ctx);
});

bot.callbackQuery("events", async (ctx) => {
  await ctx.answerCallbackQuery();

  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .order("starts_at", { ascending: true });

  if (error) {
    await ctx.reply("خطا در دریافت رویدادها. لطفاً دوباره تلاش کنید.");
    return;
  }

  if (!events || events.length === 0) {
    await ctx.reply("در حال حاضر رویدار فعالی برای ثبت‌نام وجود ندارد.", {
      reply_markup: mainMenu(isAdmin(String(ctx.from.id))),
    });
    return;
  }

  const keyboard = new InlineKeyboard();

  for (const event of events as EventData[]) {
    keyboard
      .text(`📌 ${event.title}`, `event:${event.id}`)
      .row();
  }

  keyboard.text("🔙 بازگشت به منو", "menu");

  await ctx.reply("📅 رویدادهای فعال:\n\nبرای مشاهده جزئیات روی یک رویداد بزنید.", {
    reply_markup: keyboard,
  });
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();

  await ctx.reply(
    "📖 راهنمای استفاده\n\n" +
    "۱. وارد بخش مشاهده رویدادها شوید.\n" +
    "۲. رویداد موردنظر را انتخاب کنید.\n" +
    "۳. دکمه ثبت‌نام را بزنید.\n" +
    "۴. اطلاعات خود را وارد کنید.\n" +
    "۵. اطلاعات را تأیید کنید.\n\n" +
    "برای لغو هر عملیات می‌توانید دستور /cancel را ارسال کنید."
  );
});

// -----------------------------
// Event details
// -----------------------------

bot.callbackQuery(/^event:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const eventId = ctx.match[1];

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !event) {
    await ctx.reply("این رویداد در دسترس نیست.");
    return;
  }

  const { count } = await supabase
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);

  const capacityText = event.capacity
    ? `${count || 0} از ${event.capacity}`
    : `${count || 0} نفر (بدون محدودیت ظرفیت)`;

  const keyboard = new InlineKeyboard()
    .text("✅ ثبت‌نام در این رویداد", `register:${eventId}`)
    .row()
    .text("🔙 بازگشت به رویدادها", "events");

  await ctx.reply(
    `📌 ${event.title}\n\n` +
    `${event.description}\n\n` +
    `📅 زمان: ${formatDate(event.starts_at)}\n` +
    `📍 مکان: ${event.location}\n` +
    `👥 ظرفیت: ${capacityText}`,
    { reply_markup: keyboard }
  );
});

// -----------------------------
// Registration
// -----------------------------

bot.callbackQuery(/^register:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from.id);
  const eventId = ctx.match[1];

  const { data: event } = await supabase
    .from("events")
    .select("id, title, is_active")
    .eq("id", eventId)
    .eq("is_active", true)
    .maybeSingle();

  if (!event) {
    await ctx.reply("این رویداد دیگر قابل ثبت‌نام نیست.");
    return;
  }

  const { data: existing } = await supabase
    .from("registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (existing) {
    await ctx.reply("شما قبلاً در این رویداد ثبت‌نام کرده‌اید. 😊");
    return;
  }

  await setState(userId, "reg_name", {
    eventId,
    eventTitle: event.title,
  });

  await ctx.reply(
    `📝 ثبت‌نام در رویداد «${event.title}»\n\n` +
    "لطفاً نام و نام خانوادگی خود را وارد کنید.\n\n" +
    "برای لغو، /cancel را بفرستید."
  );
});

// -----------------------------
// My registrations
// -----------------------------

bot.callbackQuery("my-registrations", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from.id);

  const { data: registrations, error } = await supabase
    .from("registrations")
    .select("*, events(title, starts_at, location)")
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    await ctx.reply("خطا در دریافت اطلاعات ثبت‌نام‌ها.");
    return;
  }

  if (!registrations || registrations.length === 0) {
    await ctx.reply("شما هنوز در هیچ رویدادی ثبت‌نام نکرده‌اید.");
    return;
  }

  let message = "📋 ثبت‌نام‌های شما:\n\n";

  for (const registration of registrations) {
    const event = registration.events as any;

    message +=
      `📌 ${event?.title || "رویداد"}\n` +
      `📅 ${event?.starts_at ? formatDate(event.starts_at) : "-"}\n` +
      `📍 ${event?.location || "-"}\n` +
      `👤 ${registration.full_name}\n\n`;
  }

  await ctx.reply(message);
});

// -----------------------------
// Admin panel
// -----------------------------

bot.callbackQuery("admin", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!isAdmin(String(ctx.from.id))) {
    await ctx.reply("⛔ شما دسترسی مدیریت ندارید.");
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("➕ ایجاد رویداد جدید", "admin-add")
    .row()
    .text("📋 فهرست رویدادها", "admin-events")
    .row()
    .text("🔙 منوی اصلی", "menu");

  await ctx.reply(
    "⚙️ پنل مدیریت\n\nبه بخش مدیریت رویدادها خوش آمدید.",
    { reply_markup: keyboard }
  );
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(String(ctx.from.id))) {
    await ctx.reply("⛔ دسترسی غیرمجاز");
    return;
  }

  await ctx.reply("⚙️ پنل مدیریت", {
    reply_markup: new InlineKeyboard()
      .text("➕ ایجاد رویداد", "admin-add")
      .row()
      .text("📋 فهرست رویدادها", "admin-events"),
  });
});

// Admin: create event
bot.callbackQuery("admin-add", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from.id);

  if (!isAdmin(userId)) {
    await ctx.reply("⛔ دسترسی غیرمجاز");
    return;
  }

  await setState(userId, "admin_title");
  await ctx.reply("عنوان رویداد جدید را وارد کنید:");
});

// Admin: list events
bot.callbackQuery("admin-events", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!isAdmin(String(ctx.from.id))) {
    await ctx.reply("⛔ دسترسی غیرمجاز");
    return;
  }

  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !events?.length) {
    await ctx.reply("هنوز رویدادی ثبت نشده است.");
    return;
  }

  for (const event of events as EventData[]) {
    const { count } = await supabase
      .from("registrations")
      .select("*", { count: "exact", head: true })
      .eq("event_id", event.id);

    const keyboard = new InlineKeyboard();

    if (event.is_active) {
      keyboard.text("⛔ غیرفعال کردن", `deactivate:${event.id}`);
    }

    await ctx.reply(
      `📌 ${event.title}\n\n` +
      `📅 ${formatDate(event.starts_at)}\n` +
      `📍 ${event.location}\n` +
      `👥 ثبت‌نام‌شده: ${count || 0}\n` +
      `وضعیت: ${event.is_active ? "فعال" : "غیرفعال"}`,
      { reply_markup: keyboard }
    );
  }
});

// Admin: deactivate event
bot.callbackQuery(/^deactivate:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!isAdmin(String(ctx.from.id))) {
    await ctx.reply("⛔ دسترسی غیرمجاز");
    return;
  }

  const { error } = await supabase
    .from("events")
    .update({ is_active: false })
    .eq("id", ctx.match[1]);

  if (error) {
    await ctx.reply("خطا در غیرفعال‌کردن رویداد.");
    return;
  }

  await ctx.reply("✅ رویداد با موفقیت غیرفعال شد.");
});

// -----------------------------
// Text messages: conversation flow
// -----------------------------

bot.on("message:text", async (ctx) => {
  const userId = String(ctx.from.id);
  const text = ctx.message.text.trim();

  // Commands are handled by their own handlers
  if (text.startsWith("/")) return;

  const current = await getState(userId);

  if (!current) {
    await ctx.reply(
      "برای شروع از منوی اصلی استفاده کنید.",
      { reply_markup: mainMenu(isAdmin(userId)) }
    );
    return;
  }

  const { state, data } = current;

  // Registration form
  if (state === "reg_name") {
    if (text.length < 3) {
      await ctx.reply("لطفاً نام و نام خانوادگی معتبر وارد کنید.");
      return;
    }

    await setState(userId, "reg_phone", {
      ...data,
      fullName: text,
    });

    await ctx.reply("📱 شماره موبایل خود را وارد کنید:");
    return;
  }

  if (state === "reg_phone") {
    const phone = text.replace(/[\s-]/g, "");

    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
      await ctx.reply("شماره موبایل معتبر نیست. لطفاً دوباره وارد کنید.");
      return;
    }

    await setState(userId, "reg_email", {
      ...data,
      phone,
    });

    await ctx.reply("📧 آدرس ایمیل خود را وارد کنید:");
    return;
  }

  if (state === "reg_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await ctx.reply("ایمیل معتبر نیست. لطفاً دوباره وارد کنید.");
      return;
    }

    await setState(userId, "reg_organization", {
      ...data,
      email: text,
    });

    await ctx.reply("🏢 نام دانشگاه یا محل کار خود را وارد کنید:");
    return;
  }

  if (state === "reg_organization") {
    if (text.length < 2) {
      await ctx.reply("لطفاً نام دانشگاه یا محل کار را وارد کنید.");
      return;
    }

    const finalData = {
      ...data,
      organization: text,
    };

    await setState(userId, "reg_confirm", finalData);

    const keyboard = new InlineKeyboard()
      .text("✅ تأیید و ثبت‌نام", "confirm-registration")
      .row()
      .text("❌ لغو", "cancel-registration");

    await ctx.reply(
      "📋 لطفاً اطلاعات خود را بررسی کنید:\n\n" +
      `👤 نام: ${finalData.fullName}\n` +
      `📱 موبایل: ${finalData.phone}\n` +
      `📧 ایمیل: ${finalData.email}\n` +
      `🏢 دانشگاه / محل کار: ${finalData.organization}\n\n` +
      `📌 رویداد: ${finalData.eventTitle}\n\n` +
      "آیا اطلاعات صحیح است؟",
      { reply_markup: keyboard }
    );
    return;
  }

  // Admin event creation
  if (isAdmin(userId)) {
    if (state === "admin_title") {
      await setState(userId, "admin_description", {
        title: text,
      });
      await ctx.reply("توضیحات رویداد را وارد کنید:");
      return;
    }

    if (state === "admin_description") {
      await setState(userId, "admin_date", {
        ...data,
        description: text,
      });
      await ctx.reply(
        "تاریخ و ساعت شروع رویداد را وارد کنید.\n\n" +
        "فرمت نمونه:\n2026-12-20 18:30"
      );
      return;
    }

    if (state === "admin_date") {
      const date = new Date(text.replace(" ", "T") + ":00+03:30");

      if (Number.isNaN(date.getTime())) {
        await ctx.reply("فرمت تاریخ صحیح نیست. مثال: 2026-12-20 18:30");
        return;
      }

      await setState(userId, "admin_location", {
        ...data,
        starts_at: date.toISOString(),
      });

      await ctx.reply("📍 محل برگزاری رویداد را وارد کنید:");
      return;
    }

    if (state === "admin_location") {
      await setState(userId, "admin_capacity", {
        ...data,
        location: text,
      });

      await ctx.reply(
        "👥 ظرفیت رویداد را وارد کنید.\n\n" +
        "اگر ظرفیت نامحدود است عدد 0 را وارد کنید."
      );
      return;
    }

    if (state === "admin_capacity") {
      const capacity = Number(text);

      if (
        !Number.isInteger(capacity) ||
        capacity < 0
      ) {
        await ctx.reply("لطفاً یک عدد صحیح بزرگ‌تر یا مساوی صفر وارد کنید.");
        return;
      }

      const { error } = await supabase
        .from("events")
        .insert({
          title: data.title,
          description: data.description,
          starts_at: data.starts_at,
          location: data.location,
          capacity: capacity === 0 ? null : capacity,
          is_active: true,
        });

      await clearState(userId);

      if (error) {
        await ctx.reply("❌ ایجاد رویداد ناموفق بود.");
        return;
      }

      await ctx.reply(
        "✅ رویداد با موفقیت ایجاد شد و در فهرست رویدادهای فعال قرار گرفت.",
        {
          reply_markup: new InlineKeyboard()
            .text("⚙️ پنل مدیریت", "admin")
            .row()
            .text("🏠 منوی اصلی", "menu"),
        }
      );
      return;
    }
  }

  await ctx.reply("لطفاً از /start شروع کنید.");
});

// Confirm registration
bot.callbackQuery("confirm-registration", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from.id);
  const current = await getState(userId);

  if (!current || current.state !== "reg_confirm") {
    await ctx.reply("اطلاعات ثبت‌نام پیدا نشد. لطفاً دوباره شروع کنید.");
    return;
  }

  const data = current.data;

  const { data: result, error } = await supabase.rpc(
    "register_for_event",
    {
      p_event_id: data.eventId,
      p_telegram_user_id: userId,
      p_telegram_username: ctx.from.username || null,
      p_full_name: data.fullName,
      p_phone: data.phone,
      p_email: data.email,
      p_organization: data.organization,
    }
  );

  await clearState(userId);

  if (error) {
    await ctx.reply("خطا در ثبت‌نام. لطفاً دوباره تلاش کنید.");
    return;
  }

  if (result === "success") {
    await ctx.reply(
      "🎉 ثبت‌نام شما با موفقیت انجام شد!\n\n" +
      `📌 رویداد: ${data.eventTitle}\n` +
      `👤 نام: ${data.fullName}\n\n` +
      "اطلاعات شما با موفقیت ذخیره شد.",
      { reply_markup: mainMenu(isAdmin(userId)) }
    );
  } else if (result === "duplicate") {
    await ctx.reply("شما قبلاً در این رویداد ثبت‌نام کرده‌اید.");
  } else if (result === "full") {
    await ctx.reply("متأسفانه ظرفیت این رویداد تکمیل شده است.");
  } else {
    await ctx.reply("این رویداد دیگر قابل ثبت‌نام نیست.");
  }
});

bot.callbackQuery("cancel-registration", async (ctx) => {
  await ctx.answerCallbackQuery();

  await clearState(String(ctx.from.id));

  await ctx.reply("ثبت‌نام لغو شد.", {
    reply_markup: mainMenu(isAdmin(String(ctx.from.id))),
  });
});

// -----------------------------
// Error handling
// -----------------------------

bot.catch((err) => {
  console.error("Telegram bot error:", err);
});

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: webhookSecret,
  timeoutMilliseconds: 9000,
});

export async function POST(request: Request) {
  return handleUpdate(request);
}
