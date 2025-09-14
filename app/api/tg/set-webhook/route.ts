import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const token = process.env.TG_BOT_TOKEN!;
    const secret = process.env.TG_WEBHOOK_SECRET!;
    const base = process.env.PUBLIC_SITE_URL!;
    const url = `${base}/api/tg/webhook?secret=${encodeURIComponent(secret)}`;

    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message','callback_query'] }),
    });
    const j = await r.json();
    return NextResponse.json(j);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
