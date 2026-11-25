export const eventTypes = { call: 'Llamada', review: 'Revisión' };
const twoDigits = value => String(value).padStart(2, '0');
export const dateKey = date => date.getFullYear() + '-' + twoDigits(date.getMonth() + 1) + '-' + twoDigits(date.getDate());
export const localDate = key => new Date(key + 'T12:00:00');

export function monthDays(month) {
  const first = localDate(month + '-01');
  const offset = (first.getDay() + 6) % 7;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + last) / 7) * 7 }, (_, index) =>
    dateKey(new Date(first.getFullYear(), first.getMonth(), index - offset + 1, 12))
  );
}

export function shiftMonth(month, offset) {
  const first = localDate(month + '-01');
  first.setMonth(first.getMonth() + offset);
  return dateKey(first).slice(0, 7);
}

export function webLink(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  throw Error('Introduce un enlace válido que empiece por https:// o http://.');
}

export function eventMessage(event, client) {
  const { type, date, time, link } = event;
  const day = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(localDate(date));
  return [
    'Hola, ' + client.name.trim().split(/\s+/)[0] + '.',
    'Te recuerdo nuestra ' + eventTypes[type].toLowerCase() + ' del ' + day + ' a las ' + time + '.',
    link ? 'Enlace: ' + link : '',
    'David Llanos · Coaching'
  ].filter(Boolean).join('\n\n');
}

const icsText = value => value.replace(/[\\;,\r\n]/g, character =>
  character === '\r' ? '' : character === '\n' ? '\\n' : '\\' + character
);
const utc = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [''];
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { lines.push(' '); bytes = 1; }
    lines[lines.length - 1] += character;
    bytes += size;
  }
  return lines.join('\r\n');
}

export function eventCalendar(event, client, now = new Date()) {
  const start = new Date(event.date + 'T' + event.time);
  const end = new Date(start.getTime() + event.duration * 60_000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//David Llanos//Coaching//ES',
    'BEGIN:VEVENT', 'UID:' + event.id + '@david-llanos-coaching.local',
    'DTSTAMP:' + utc(now), 'DTSTART:' + utc(start), 'DTEND:' + utc(end),
    'SUMMARY:' + icsText(eventTypes[event.type] + ' · ' + client.name),
    ...(event.link ? ['URL:' + webLink(event.link)] : []),
    ...(event.notes ? ['DESCRIPTION:' + icsText(event.notes)] : []),
    ...(event.reminder ? ['BEGIN:VALARM', 'TRIGGER:-PT' + event.reminder + 'M',
      'ACTION:DISPLAY', 'DESCRIPTION:' + eventTypes[event.type] + ' · David Llanos Coaching', 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR', ''
  ].map(foldLine).join('\r\n');
}
