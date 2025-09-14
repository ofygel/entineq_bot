import { NextRequest, NextResponse } from 'next/server';
import { sbAdmin } from '@/lib/supabase-admin';
import { tgAnswerCb, tgEditText, formatOrder, kbTaken, tgSend, kbDM, kbRequestPhone } from '@/lib/telegram';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Простейшая защита вебхука query-параметром
  const secret = req.nextUrl.searchParams.get('secret');
  if (!process.env.TG_WEBHOOK_SECRET || secret !== process.env.TG_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => ({}));

  try {
    // 1) /bind_drivers_channel — отправляется ИЗ самого канала
    if (update.message?.text?.startsWith?.('/bind_drivers_channel')) {
      const chat = update.message.chat;
      if (chat?.type !== 'channel') {
        return NextResponse.json({ ok: true }); // игнор
      }
      await sbAdmin.from('bot_settings')
        .upsert({ key: 'drivers_channel_id', value: String(chat.id) }, { onConflict: 'key' });
      await tgSend(chat.id, '✅ Канал привязан. Новые заказы будут публиковаться здесь.');
      return NextResponse.json({ ok: true });
    }

    // короткая справка
    if (update.message?.text?.startsWith?.('/help')) {
      await tgSend(update.message.chat.id, 'Команды:\n/start — регистрация и отправка номера\n/bind_drivers_channel — привязать канал (в канале).');
      return NextResponse.json({ ok: true });
    }

    // 2) Сообщение с контактом
    if (update.message?.contact) {
      const u = update.message.from;
      const c = update.message.contact;
      if (u && c && c.user_id === u.id) {
        await sbAdmin.from('tg_executors').upsert({
          tg_id: u.id,
          username: u.username ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          phone: c.phone_number,
        });
        await tgSend(u.id, '✅ Номер сохранён. Ждите заказы.', { remove_keyboard: true });
      }
      return NextResponse.json({ ok: true });
    }

    // 3) /start — регистрируем исполнителя и просим номер
    if (update.message?.text?.startsWith?.('/start')) {
      const u = update.message.from;
      if (u) {
        const { data: ex } = await sbAdmin
          .from('tg_executors')
          .upsert({
            tg_id: u.id,
            username: u.username ?? null,
            first_name: u.first_name ?? null,
            last_name: u.last_name ?? null,
          })
          .select('phone')
          .single();
        if (ex?.phone) {
          await tgSend(u.id, '👋 Готов принимать заказы.\nЖдите публикации в канале и нажимайте «Взять».');
        } else {
          await tgSend(
            u.id,
            '👋 Для продолжения отправьте свой номер телефона кнопкой ниже.',
            kbRequestPhone()
          );
        }
      }
      return NextResponse.json({ ok: true });
    }

    // 4) Нажатия на инлайн-кнопки
    if (update.callback_query) {
      const { id: cbId, data, message, from } = update.callback_query;
      if (!data || !message) {
        await tgAnswerCb(cbId);
        return NextResponse.json({ ok: true });
      }

      // accept:<orderId>  или  release:<orderId>
      const [action, idStr] = String(data).split(':');
      const orderId = Number(idStr);

      if (action === 'accept') {
        // ищем телефон исполнителя, если сохранён
        const { data: exec } = await sbAdmin
          .from('tg_executors')
          .select('phone')
          .eq('tg_id', from.id)
          .maybeSingle();

        // атомарная попытка занять заказ
        const claimPayload: any = {
          status: 'CLAIMED',
          claimed_by_tg_id: from.id,
          claimed_by_tg_username: from.username ?? null,
          claimed_at: new Date().toISOString(),
        };
        if (exec?.phone) claimPayload.claimed_by_tg_phone = exec.phone;

        let { data: updated, error } = await sbAdmin
          .from('orders')
          .update(claimPayload)
          .eq('id', orderId)
          .is('claimed_by', null)
          .or('claimed_by_tg_id.is.null')
          .eq('status', 'NEW')
          .select('*')
          .single();

        if (error && error.message?.includes('claimed_by_tg_phone')) {
          // колонка ещё не создана
          ({ data: updated, error } = await sbAdmin
            .from('orders')
            .update({
              status: 'CLAIMED',
              claimed_by_tg_id: from.id,
              claimed_by_tg_username: from.username ?? null,
              claimed_at: new Date().toISOString(),
            })
            .eq('id', orderId)
            .is('claimed_by', null)
            .or('claimed_by_tg_id.is.null')
            .eq('status', 'NEW')
            .select('*')
            .single());
        }

        if (error || !updated) {
          await tgAnswerCb(cbId, 'Увы, заказ уже занят', true);
          return NextResponse.json({ ok: true });
        }

        // правим пост в канале
        await tgEditText(
          message.chat.id,
          message.message_id,
          `${formatOrder(updated)}\n\n<i>Занял @${from.username ?? from.id}</i>`,
          kbTaken(from.username)
        );

        // регистрируем исполнителя и шлём ЛС
        await sbAdmin.from('tg_executors').upsert({
          tg_id: from.id,
          username: from.username ?? null,
          first_name: from.first_name ?? null,
          last_name: from.last_name ?? null,
          phone: exec?.phone ?? null,
        });

        const clientPhone = updated.client_phone ? `\nТелефон клиента: <b>${updated.client_phone}</b>` : '';
        await tgSend(
          from.id,
          `🆕 Заказ #${updated.id}\n${formatOrder(updated)}${clientPhone}`,
          kbDM(updated.id)
        );

        await tgAnswerCb(cbId, 'Заказ ваш!');
        return NextResponse.json({ ok: true });
      }

      if (action === 'release') {
        // освободить заказ (нажато из лички)
        const { data: o } = await sbAdmin.from('orders').select('*').eq('id', orderId).single();
        if (o?.status === 'CLAIMED' && o?.claimed_by_tg_id === from.id) {
          const { data: released } = await sbAdmin
            .from('orders')
            .update({
              status: 'NEW',
              claimed_by_tg_id: null,
              claimed_by_tg_username: null,
              claimed_by: null,
            })
            .eq('id', orderId)
            .select('*')
            .single();

          if (released?.tg_channel_id && released?.tg_message_id) {
            await tgEditText(
              released.tg_channel_id,
              released.tg_message_id,
              formatOrder(released),
              { inline_keyboard: [[{ text: '✅ Взять', callback_data: `accept:${orderId}` }]] }
            );
          }
          await tgAnswerCb(cbId, 'Освободили');
        } else {
          await tgAnswerCb(cbId);
        }
        return NextResponse.json({ ok: true });
      }

      // noop
      await tgAnswerCb(cbId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('TG webhook error', e);
    return NextResponse.json({ ok: false }, { status: 200 }); // Telegram ждёт 200
  }
}
