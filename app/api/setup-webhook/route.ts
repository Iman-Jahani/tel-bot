
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const token = process.env.BOT_TOKEN;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const setupSecret = process.env.SETUP_SECRET;

  if (!token || !webhookSecret || !setupSecret) {
    return NextResponse.json(
      { error: "Environment variables are missing" },
      { status: 500 }
    );
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${setupSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://tel-bot-ten.vercel.app/api/telegram",
          secret_token: webhookSecret,
        }),
        cache: "no-store",
      }
    );

    const result = await response.json();

    return NextResponse.json(result, {
      status: response.ok ? 200 : 502,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not connect to Telegram API from Vercel" },
      { status: 502 }
    );
  }
}
