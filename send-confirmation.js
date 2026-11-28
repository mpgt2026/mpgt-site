// Vercel serverless function: emails the client when the Admin confirms a booking.
// Security: only a logged-in administrator can call it (their Supabase login token is checked).
// It never uses a Supabase secret key; the booking is read with the administrator's own token.
// Environment variables (Vercel > Settings > Environment Variables):
//   RESEND_API_KEY   (required)  API key from resend.com
//   MAIL_FROM        (required)  e.g.  Manila Pampanga Go Taxi <bookings@manilapampangagotaxi.com>
//   MAIL_REPLY_TO    (optional)  e.g.  manilapampangagotaxi@gmail.com
const SB_URL = process.env.SUPABASE_URL || 'https://mxkrsciiaofatycrgjby.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_OxSAn5UQtPxigd3DZh6lEg_kPDEqCLf';
const SITE = 'https://www.manilapampangagotaxi.com';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const T = {
  en: {
    subject: (ref) => 'Your booking ' + ref + ' is confirmed - Manila Pampanga Go Taxi',
    hi: (n) => 'Hello ' + n + ',',
    paid: 'Good news! We received your payment and your booking is confirmed.',
    cash: 'Good news! Your booking is confirmed. You will pay in cash on the day of your trip.',
    rows: { driver: 'Driver', car: 'Car', plate: 'Plate number', ref: 'Booking number', trip: 'Trip', date: 'Date and time', pax: 'Passengers', vehicle: 'Vehicle', amount: 'Amount', pay: 'Payment' },
    payPaid: 'Paid', payCash: 'Cash on the day',
    driver: 'Your driver will contact you before pickup.',
    track: 'Check your booking status anytime:',
    help: 'Questions? Reply to this email or message us on WhatsApp or Viber at +63 934 598 6176, or KakaoTalk at 0985 390 0002.',
    thanks: 'Thank you for choosing Manila Pampanga Go Taxi.'
  },
  zh: {
    subject: (ref) => '您的预订 ' + ref + ' 已确认 - Manila Pampanga Go Taxi',
    hi: (n) => '您好 ' + n + '，',
    paid: '好消息！我们已收到您的付款，您的预订已确认。',
    cash: '好消息！您的预订已确认。请在出行当天以现金支付。',
    rows: { driver: '司机', car: '车辆', plate: '车牌号', ref: '预订编号', trip: '行程', date: '日期和时间', pax: '乘客人数', vehicle: '车型', amount: '金额', pay: '付款' },
    payPaid: '已付款', payCash: '当天现金支付',
    driver: '司机将在接送前联系您。',
    track: '您可以随时查询预订状态：',
    help: '有疑问？请直接回复此邮件，或通过 WhatsApp 或 Viber 联系我们：+63 934 598 6176，或 KakaoTalk：0985 390 0002。',
    thanks: '感谢您选择 Manila Pampanga Go Taxi。'
  },
  ko: {
    subject: (ref) => '예약 ' + ref + ' 이(가) 확정되었습니다 - Manila Pampanga Go Taxi',
    hi: (n) => n + '님, 안녕하세요.',
    paid: '결제가 확인되어 예약이 확정되었습니다.',
    cash: '예약이 확정되었습니다. 여행 당일 현금으로 결제해 주세요.',
    rows: { driver: '기사님', car: '차량', plate: '차량 번호', ref: '예약 번호', trip: '여정', date: '날짜 및 시간', pax: '승객 수', vehicle: '차량', amount: '금액', pay: '결제' },
    payPaid: '결제 완료', payCash: '당일 현금 결제',
    driver: '기사님이 탑승 전에 연락드립니다.',
    track: '예약 상태는 언제든 확인하실 수 있습니다:',
    help: '문의사항은 이 메일에 회신하시거나 WhatsApp 또는 Viber +63 934 598 6176, 또는 KakaoTalk 0985 390 0002 로 연락해 주세요.',
    thanks: 'Manila Pampanga Go Taxi를 이용해 주셔서 감사합니다.'
  }
};

function fmtWhen(d, t) {
  let out = d || '';
  try {
    const p = String(d).split('-');
    out = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (e) {}
  try { const q = String(t).split(':'); const h = +q[0]; out += ', ' + ((h % 12) || 12) + ':' + q[1] + (h >= 12 ? ' PM' : ' AM'); } catch (e) {}
  return out;
}

function build(b) {
  const L = T[b.lang] || T.en;
  const q = Number(b.quote);
  const isCash = b.pay === 'cash';
  const rows = [
    [L.rows.ref, b.ref], [L.rows.trip, b.route], [L.rows.date, fmtWhen(b.date, b.time)],
    [L.rows.pax, b.pax], [L.rows.vehicle, b.vehicle]
  ];
  if (q > 0) rows.push([L.rows.amount, 'PHP ' + q.toLocaleString('en-US')]);
  rows.push([L.rows.pay, isCash ? L.payCash : L.payPaid]);
  if (b.driver) rows.push([L.rows.driver, b.driver]);
  if (b.car) rows.push([L.rows.car, b.car]);
  if (b.plate) rows.push([L.rows.plate, b.plate]);
  const intro = isCash ? L.cash : L.paid;
  const trackUrl = SITE + '/track';
  const text = [L.hi(b.name), '', intro, ''].concat(rows.map((r) => r[0] + ': ' + r[1]), ['', L.driver, '', L.track + ' ' + trackUrl, '', L.help, '', L.thanks]).join('\n');
  const tr = rows.map((r) => '<tr><td style="padding:8px 14px 8px 0;color:#4A5D70;font-size:13px;vertical-align:top">' + esc(r[0]) + '</td><td style="padding:8px 0;color:#102A43;font-size:15px;font-weight:600">' + esc(r[1]) + '</td></tr>').join('');
  const html = '<div style="background:#F5F1E8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-top:4px solid #C9A66B"><div style="background:#102A43;padding:18px 24px;color:#C9A66B;font-size:18px;font-weight:700;letter-spacing:.04em">Manila Pampanga Go Taxi</div><div style="padding:26px 24px;color:#102A43;font-size:15px;line-height:1.6"><p style="margin:0 0 12px">' + esc(L.hi(b.name)) + '</p><p style="margin:0 0 18px;font-weight:600;color:#2F7D4F">' + esc(intro) + '</p><table style="border-collapse:collapse;width:100%;border-top:1px solid #E3DCCB">' + tr + '</table><p style="margin:18px 0 0">' + esc(L.driver) + '</p><p style="margin:18px 0 0">' + esc(L.track) + '<br><a href="' + trackUrl + '" style="color:#8F6B2E;font-weight:700">' + trackUrl + '</a></p><p style="margin:18px 0 0;color:#4A5D70;font-size:13.5px">' + esc(L.help) + '</p><p style="margin:18px 0 0">' + esc(L.thanks) + '</p></div></div></div>';
  return { subject: L.subject(b.ref), text, html };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  const auth = String(req.headers.authorization || '');
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'login' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const ref = body && body.ref;
  if (!/^MPG-[0-9]{3,8}$/.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'ref' });
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return res.status(503).json({ ok: false, error: 'not-configured' });
  try {
    const H = { apikey: SB_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const adm = await fetch(SB_URL + '/rest/v1/rpc/is_admin', { method: 'POST', headers: H, body: '{}' });
    if (!adm.ok || (await adm.json()) !== true) return res.status(403).json({ ok: false, error: 'not-admin' });
    const r = await fetch(SB_URL + '/rest/v1/bookings?select=status,data&ref=eq.' + encodeURIComponent(ref), { headers: H });
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not-found' });
    const b = Object.assign({}, rows[0].data, { ref });
    if (rows[0].status !== 'confirmed' && rows[0].status !== 'completed') return res.status(409).json({ ok: false, error: 'not-confirmed' });
    const to = String(b.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(200).json({ ok: false, error: 'no-email' });
    const m = build(b);
    const payload = { from: process.env.MAIL_FROM, to: [to], subject: m.subject, html: m.html, text: m.text };
    if (process.env.MAIL_REPLY_TO) payload.reply_to = process.env.MAIL_REPLY_TO;
    const out = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!out.ok) return res.status(502).json({ ok: false, error: 'send-failed', status: out.status });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
module.exports._build = build;
