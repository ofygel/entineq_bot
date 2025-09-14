import { NextResponse, NextRequest } from 'next/server';
import { sbAdmin } from '../../../lib/supabase-admin';
import { tgSend, formatOrder, kbForNew } from '../../../lib/telegram';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Ожидаем минимальный набор
    const payload = {
      type: body.type,                               // 'TAXI' | 'DELIVERY'
      city: body.city ?? null,
      from_addr: body.from ?? body.from_addr,
      to_addr: body.to ?? body.to_addr,
      distance_km: body.distanceKm ?? body.distance_km ?? null,
      comment_text: body.comment ?? body.comment_text ?? null,
      price_estimate: body.priceEstimate ?? body.price_estimate ?? null,
      client_phone: body.clientPhone ?? body.client_phone ?? null,
      status: 'NEW',
      created_by: null as any,
    };
    if (!payload.type || !payload.from_addr || !payload.to_addr) {
      return NextResponse.json({ error: 'type, from, to are required' }, { status: 400 });
    }

    // 1) Создаём заказ
    const { data: created, error } = await sbAdmin
      .from('orders')
      .insert(payload)
      .select('*')
      .single();
    if (error || !created) throw error ?? new Error('Insert failed');

    // 2) Берём id канала из настроек
    const { data: set } = await sbAdmin.from('bot_settings').select('value').eq('key', 'drivers_channel_id').maybeSingle();
    const channelId = set?.value?.toString().trim();
    if (channelId) {
      const text = formatOrder(created);
      const siteUrl = process.env.PUBLIC_SITE_URL ? `${process.env.PUBLIC_SITE_URL}/client` : undefined;
      const msg = await tgSend(channelId, text, kbForNew(created.id, siteUrl));

      // 3) Сохраняем message id, чтобы потом править пост
      await sbAdmin.from('orders').update({
        tg_channel_id: Number(msg.chat.id),
        tg_message_id: Number(msg.message_id),
      }).eq('id', created.id);
    }

    return NextResponse.json({ order: created }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/orders error', e);
    return NextResponse.json({ error: e.message ?? 'internal' }, { status: 500 });
  }
}

export async function GET() {
  // простой health
  return NextResponse.json({ ok: true });
}
