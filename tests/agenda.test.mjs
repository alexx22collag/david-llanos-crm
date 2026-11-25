import assert from 'node:assert/strict';
import test from 'node:test';
import { monthDays, shiftMonth, eventCalendar, eventMessage, webLink } from '../dist/agenda.js';

test('el calendario empieza el lunes y cruza al año siguiente sin perder días', () => {
  const days = monthDays('2026-12');
  assert.equal(days[0], '2026-11-30');
  assert.equal(days.at(-1), '2027-01-03');
  assert.equal(days.length % 7, 0);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('el archivo de calendario conserva hora, duración, enlace y aviso, y el mensaje omite las notas privadas', () => {
  const client = { name:'Lucía Martínez' };
  const event = { id:'123', type:'call', date:'2026-12-03', time:'10:30', duration:45, reminder:15, link:'https://example.com/llamada', notes:'Privado; línea 1\nlínea 2' };
  const calendar = eventCalendar(event, client, new Date('2026-11-25T18:30:00Z'));
  const timeLine = (time, name) => name + ':' + new Date(event.date + 'T' + time).toISOString().replace(/[-:]/g, '').replace('.000', '');
  assert.ok(calendar.includes(timeLine('10:30', 'DTSTART')));
  assert.ok(calendar.includes(timeLine('11:15', 'DTEND')));
  assert.ok(calendar.includes('TRIGGER:-PT15M\r\nACTION:DISPLAY'));
  assert.ok(calendar.includes('URL:' + event.link));
  assert.ok(calendar.includes('Privado\\; línea 1\\nlínea 2'));
  assert.ok(eventMessage(event, client).includes(event.link));
  assert.ok(!eventMessage(event, client).includes('Privado'));
  assert.throws(() => webLink('javascript:alert(1)'), /enlace válido/);
});
