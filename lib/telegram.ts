import 'server-only';

const BOT_TOKEN = process.env.TG_BOT_TOKEN!;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

type RM = { inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>> };

async function tg(method: string, payload: any) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`TG ${method} error: ${r.status} ${JSON.stringify(j)}`);
  return j.result;
}

export const tgSend = (chat_id: number | string, text: string, reply_markup?: RM) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });

export const tgEditText = (chat_id: number | string, message_id: number, text: string, reply_markup?: RM) =>
  tg('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });

export const tgEditMarkup = (chat_id: number | string, message_id: number, reply_markup?: RM) =>
  tg('editMessageReplyMarkup', { chat_id, message_id, reply_markup });

export const tgAnswerCb = (cb_id: string, text?: string, show_alert = false) =>
  tg('answerCallbackQuery', { callback_query_id: cb_id, text, show_alert });

export const tgGetMe = () => tg('getMe', {});

export function formatOrder(o: any) {
  const lines = [
    `<b>${o.type === 'DELIVERY' ? 'ДОСТАВКА' : 'ТАКСИ'}</b> ${o.city ? '· ' + o.city : ''}`,
    `От: <b>${escape(o.from_addr ?? o.from ?? '')}</b>`,
    `Куда: <b>${escape(o.to_addr ?? o.to ?? '')}</b>`,
  ];
  if (o.comment_text || o.comment) lines.push(`Комментарий: ${escape(o.comment_text ?? o.comment)}`);
  if (o.distance_km || o.distanceKm) lines.push(`Дистанция: ${o.distance_km ?? o.distanceKm} км`);
  if (o.price_estimate || o.priceEstimate)
    lines.push(`Предварительно: <b>${Number(o.price_estimate ?? o.priceEstimate ?? 0).toLocaleString()}₸</b>`);
  return lines.join('\n');
}

export function kbForNew(orderId: number | string, siteUrl?: string): RM {
  return {
    inline_keyboard: [
      [{ text: '✅ Взять', callback_data: `accept:${orderId}` }],
      siteUrl ? [{ text: 'Открыть на сайте', url: siteUrl }] : [],
    ].filter(Boolean) as any,
  };
}

export function kbTaken(username?: string): RM {
  return { inline_keyboard: [[{ text: `Занят ${username ? `@${username}` : ''}`, callback_data: 'noop' }]] };
}

export function kbDM(orderId: number | string): RM {
  return { inline_keyboard: [[{ text: '❌ Отказаться', callback_data: `release:${orderId}` }]] };
}

function escape(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
