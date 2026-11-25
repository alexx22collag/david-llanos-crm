import {
  sections, uid, freshWeek, seed, submitWeek, returnWeek, approveWeek, archiveWeek,
  createExercise, updateExercise, maxSets, migrateTraining, previousExercise, hasSetLog
} from './model.js';
import { dateKey, localDate, monthDays, shiftMonth, eventTypes, webLink, eventCalendar, eventMessage } from './agenda.js';
import { dashboard, clientDirectory, directoryRows, reviewInbox, clientProfile, appointmentStatus } from './coach.js';

const key = 'david-llanos-crm-v1';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toast = document.querySelector('#toast');
let data;
try { data = migrateTraining(JSON.parse(localStorage.getItem(key)) || seed()); } catch { data = migrateTraining(seed()); }
let role = 'coach';
let clientId = data.clients[0]?.id;
let view = 'home';
let day = '';
let toastTimer;
let restTimer;
let restInterval;
let agendaDate = dateKey(new Date());
let dashboardVisible = false;
let clientQuery = '';
let clientFilter = 'all';
let reviewFilter = 'submitted';
let agendaFilter = 'all';
let authMode = '';
let session = null;
let revision = 0;
let pendingSave = Promise.resolve();
let emailLoginEnabled = false;
let emailLoginToken = '';
const client = () => data.clients.find(c => c.id === clientId);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value).toLocaleString('es-ES');
const date = value => new Intl.DateTimeFormat('es-ES', {dateStyle:'medium'}).format(new Date(value.length === 10 ? value + 'T12:00:00' : value));
const initials = name => name.trim().split(/\s+/).slice(0,2).map(word => word[0].toUpperCase()).join('');
const btn = (label, action, variant = '', value = '') => '<button type="button" class="btn '+variant+'" data-action="'+action+'" data-value="'+esc(value)+'">'+label+'</button>';
const badge = week => '<span class="badge '+({active:'gray',submitted:'',approved:'green'}[week.status])+'">'+
  (week.status === 'active' && week.revisionNote ? 'Por corregir' : {active:'En curso',submitted:'Por revisar',approved:'Aprobada'}[week.status])+'</span>';
const empty = label => '<p class="empty">'+label+'</p>';
const resourceTypes = { video: 'Vídeo de técnica', nutrition: 'Alimentación' };
const longDate = key => new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' }).format(localDate(key));
const monthName = key => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(localDate(key));
const external = (label, url, classes = 'btn') => url
  ? '<a class="' + classes + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
  : '';
function notify(message) {
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3300);
}
function stopRest() {
  clearInterval(restInterval);
  restTimer = undefined;
}
function updateRest() {
  const remaining = restTimer ? Math.ceil((restTimer.end - Date.now()) / 1000) : 0;
  if (restTimer && remaining <= 0) {
    stopRest();
    notify('Descanso terminado');
  }
  for (const button of app.querySelectorAll('[data-action="rest"]')) {
    const running = restTimer?.exerciseId === button.dataset.value;
    button.textContent = running
      ? 'Detener descanso · ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0')
      : 'Iniciar descanso';
    if (running) button.setAttribute('aria-label', 'Detener descanso');
    else button.removeAttribute('aria-label');
  }
}
function toggleRest(exercise) {
  const wasRunning = restTimer?.exerciseId === exercise.id;
  stopRest();
  if (!wasRunning) {
    restTimer = { exerciseId: exercise.id, end: Date.now() + exercise.restSeconds * 1000 };
    restInterval = setInterval(updateRest, 250);
  }
  updateRest();
}
async function persist(change, selectedId) {
  const next = structuredClone(data);
  try {
    change(next, next.clients.find(c => c.id === selectedId));
    if (authMode === 'google') {
      const response = await fetch('/api/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: next, revision }), signal: AbortSignal.timeout(12_000)
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      data = result.data;
      revision = result.revision;
    } else {
      localStorage.setItem(key, JSON.stringify(next));
      data = next;
    }
    return true;
  } catch (error) {
    notify(error.name === 'QuotaExceededError' ? 'No queda espacio para guardar en este dispositivo.' : error.message);
    return false;
  }
}
function commit(change) {
  const selectedId = clientId;
  const save = pendingSave.then(() => persist(change, selectedId));
  pendingSave = save.catch(() => {});
  return save;
}
function navigate(to) {
  view = to;
  day = '';
  render();
  window.scrollTo(0,0);
  app.querySelector('h1')?.focus({preventScroll:true});
}
function head(kicker, title, text, actions = '') {
  return '<div class="intro"><div><div class="eyebrow">'+kicker+'</div><h1 tabindex="-1">'+title+'</h1><p>'+text+'</p></div>'+(actions ? '<div class="actions">'+actions+'</div>' : '')+'</div>';
}
const brandLockup = '<img class="brand-lockup" src="./david-llanos-lockup.jpg" alt="David Llanos Coaching" width="1040" height="484">';
const stat = (label, value, hint) => '<div class="stat"><div class="label">'+label+'</div><div class="value">'+value+'</div><div class="hint">'+hint+'</div></div>';
function agendaPage() {
  return head('Calendario del entrenador', 'Agenda', 'Programa llamadas y revisiones para tus clientes.', btn('+ Nueva cita', 'new-event', 'primary')) +
    '<div class="agenda-toolbar"><label>Mostrar <select id="agenda-filter">' +
    [['all', 'Todas las citas'], ['call', 'Llamadas'], ['review', 'Revisiones']].map(([value, label]) =>
      '<option value="' + value + '"' + (agendaFilter === value ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select></label></div>' + calendarPanel();
}
function calendarPanel() {
  const month = agendaDate.slice(0, 7);
  const today = dateKey(new Date());
  const entries = data.agenda.filter(item => agendaFilter === 'all' || item.type === agendaFilter)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const onDay = entries.filter(entry => entry.date === agendaDate);
  const upcoming = entries.filter(entry => !entry.cancelled && !entry.completed && entry.date > agendaDate).slice(0, 4);
  const dayCells = monthDays(month).map(key => {
    const count = entries.filter(entry => !entry.cancelled && entry.date === key).length;
    const label = longDate(key) + (count ? ', ' + count + (count === 1 ? ' cita' : ' citas') : '');
    const classes = ['calendar-day', key.slice(0, 7) !== month && 'outside', key === today && 'today'].filter(Boolean).join(' ');
    return '<button type="button" class="' + classes + '" data-action="agenda-day" data-value="' + key +
      '" aria-pressed="' + (key === agendaDate) + '"' + (key === today ? ' aria-current="date"' : '') +
      ' aria-label="' + esc(label) + '">' + Number(key.slice(-2)) +
      (count ? '<span aria-hidden="true" class="day-count">' + count + '</span>' : '') + '</button>';
  }).join('');
  const weekdayLabels = [
    ['Lun', 'Lunes'], ['Mar', 'Martes'], ['Mié', 'Miércoles'], ['Jue', 'Jueves'],
    ['Vie', 'Viernes'], ['Sáb', 'Sábado'], ['Dom', 'Domingo']
  ].map(([short, full]) => '<span aria-label="' + full + '">' + short + '</span>').join('');
  return '<div class="grid agenda-grid"><section class="card glass-panel calendar-card" aria-label="Calendario">' +
    '<div class="card-head"><h2 class="calendar-month">' + monthName(agendaDate) + '</h2><div class="actions">' +
    btn('Anterior', 'agenda-month', '', -1) + btn('Hoy', 'agenda-today') + btn('Siguiente', 'agenda-month', '', 1) + '</div></div>' +
    '<div class="calendar-weekdays">' + weekdayLabels + '</div><div class="calendar-days">' + dayCells + '</div></section>' +
    '<section class="card glass-panel agenda-date-card"><div class="card-head agenda-day-header">' +
    '<span class="agenda-date-number" aria-hidden="true">' + Number(agendaDate.slice(-2)) + '</span>' +
    '<div><div class="agenda-day-caption">Agenda del día</div><h2 class="agenda-heading">' + longDate(agendaDate) + '</h2></div></div>' +
    (onDay.map(entry => eventListItem(entry)).join('') || '<div class="agenda-empty"><strong>Sin citas este día</strong>' +
      '<p>Puedes añadir una llamada o revisión.</p>' + btn('Programar cita', 'new-event') + '</div>') +
    (upcoming.length ? '<h3 class="upcoming-title">Próximas citas</h3>' + upcoming.map(entry => eventListItem(entry, true)).join('') : '') +
    '</section></div>';
}

function eventListItem(entry, showDate = false) {
  const assigned = data.clients.find(c => c.id === entry.clientId);
  const title = eventTypes[entry.type] + ' · ' + (assigned?.name || 'Cliente');
  return '<button class="agenda-entry' + (entry.completed ? ' completed' : '') + '" data-action="show-event" data-value="' + esc(entry.id) + '">' +
    '<span class="agenda-time">' + (showDate ? date(entry.date) + ' · ' : '') + esc(entry.time) + '</span>' +
    '<strong>' + esc(title) + '</strong>' +
    (entry.cancelled || entry.completed || entry.example ? '<span class="footer-note">' +
      [entry.cancelled || entry.completed ? appointmentStatus(entry) : '', entry.example ? 'Ejemplo' : ''].filter(Boolean).join(' · ') + '</span>' : '') + '</button>';
}
const field = (name, label, attrs = '', value = '') => '<label>'+label+'<input name="'+name+'" '+attrs+' value="'+esc(value)+'"></label>';
const area = (name,label,value = '', attrs = '') => '<label class="full">'+label+'<textarea name="'+name+'" '+attrs+'>'+esc(value)+'</textarea></label>';
function selectField(name, label, options, selected = '') {
  return '<label>' + label + '<select name="' + name + '">' + options.map(([value, title]) =>
    '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(title) + '</option>'
  ).join('') + '</select></label>';
}
function weeklyProgress(week) {
  const sets = week.exercises.flatMap(exercise => exercise.sets);
  const done = sets.filter(set => set.done).length;
  return { done, total: sets.length, text: done + ' de ' + sets.length + ' series hechas', percent: sets.length ? Math.round(done / sets.length * 100) : 0 };
}

function legacyLog(log) {
  if (!log) return '';
  const details = [
    log.weight !== '' && number(log.weight) + ' kg',
    log.reps && esc(log.reps) + ' rep.',
    log.done && 'Marcado como hecho'
  ].filter(Boolean);
  return '<p class="footer-note record"><strong>Resumen del registro anterior</strong><br>' + details.join(' · ') + '</p>';
}

const setFields = [
  { name: 'weight', heading: 'Peso (kg)', label: 'Peso en kg', min: 0, max: 999, step: 'any', mode: 'decimal' },
  { name: 'reps', heading: 'Reps', label: 'Repeticiones', min: 0, max: 999, step: 1, mode: 'numeric' },
  { name: 'rpe', heading: 'RPE', label: 'RPE', min: 1, max: 10, step: 0.5, mode: 'decimal' },
  { name: 'rir', heading: 'RIR', label: 'RIR', min: 0, max: 20, step: 1, mode: 'numeric' }
];

function setTable(e, editable, previous) {
  const columns = '<th scope="col" role="columnheader">Serie</th>' +
    setFields.map(({ heading, label }) => '<th scope="col" role="columnheader" aria-label="' + label + '">' + heading + '</th>').join('') +
    '<th scope="col" role="columnheader">Hecha</th>';
  const rows = e.sets.map((set, index) => {
    const n = index + 1;
    const attrs = ' data-exercise="' + esc(e.id) + '" data-set="' + index + '"';
    const prior = previous?.sets[index];
    const reference = prior && hasSetLog(prior) ? [
      prior.weight !== '' && number(prior.weight) + ' kg',
      prior.reps !== '' && number(prior.reps) + ' rep.',
      prior.rpe !== '' && 'RPE ' + number(prior.rpe),
      prior.rir !== '' && 'RIR ' + number(prior.rir)
    ].filter(Boolean).join(' · ') : '';
    const rowHeader = '<th scope="row" role="rowheader"><span class="set-cell-label" aria-hidden="true">Serie </span>' + n + '</th>';
    const cell = (heading, value) => '<td role="cell"><span class="set-cell-label" aria-hidden="true">' + heading + '</span>' + value + '</td>';
    const values = setFields.map(({ name, heading, label, min, max, step, mode }) => {
      const value = editable
        ? '<input type="number" min="' + min + '" max="' + max + '" step="' + step + '" inputmode="' + mode +
          '" aria-label="' + label + ', serie ' + n + ' de ' + esc(e.name) + '" value="' + esc(set[name]) + '"' + attrs + ' data-field="' + name + '">'
        : (set[name] === '' ? '—' : number(set[name]));
      return cell(heading, value);
    }).join('');
    const done = editable
      ? '<label class="set-check"><input type="checkbox" aria-label="Marcar serie ' + n + ' de ' + esc(e.name) + ' como hecha"' + attrs +
        ' data-field="done" ' + (set.done ? 'checked' : '') + '></label>'
      : (set.done ? '<span class="set-done">Sí</span>' : '—');
    return '<tr class="set-row" role="row">' + rowHeader + values + cell('Hecha', done) + '</tr>' +
      (reference ? '<tr class="set-reference" role="row"><td colspan="6" role="cell">Anterior, serie ' + n + ': ' + reference + '</td></tr>' : '');
  }).join('');
  return '<table class="sets-table" role="table" aria-label="Series de ' + esc(e.name) +
    '"><thead role="rowgroup"><tr role="row">' + columns + '</tr></thead><tbody role="rowgroup">' + rows + '</tbody></table>';
}

function exercise(e, editable = false, coachEdit = false, previous) {
  const prescription = [e.sets.length + ' × ' + esc(e.targetReps),
    e.target !== '' && 'Objetivo ' + number(e.target) + ' kg',
    e.restSeconds ? 'Descanso ' + e.restSeconds + ' s' : esc(e.restNote)
  ].filter(Boolean).join(' · ');
  const showTable = editable || e.sets.some(hasSetLog);
  const prior = previous?.exercise;
  const video = data.resources.find(resource => resource.id === e.videoId && resource.type === 'video');
  return '<article class="exercise"><div class="exercise-title"><div><h3>' + esc(e.name) + '</h3>' +
    '<div class="prescription">' + prescription + '</div></div>' + (coachEdit ? btn('Editar', 'edit-exercise', '', e.id) : '') + '</div>' +
    (e.coachNote ? '<p class="coach-note"><strong>Indicación del entrenador</strong><br>' + esc(e.coachNote) + '</p>' : '') +
    (video || (editable && e.restSeconds) ? '<div class="rest-control actions">' +
      (editable && e.restSeconds ? btn('Iniciar descanso', 'rest', '', e.id) : '') +
      (video ? external('Ver técnica', video.link) : '') + '</div>' : '') +
    (prior ? '<p class="footer-note prior-title">Último registro de este ejercicio · Semana ' + previous.week + '</p>' : '') +
    (showTable ? setTable(e, editable, prior) : '<p class="footer-note record">Sin registros por serie.</p>') +
    legacyLog(e.legacy) + legacyLog(prior?.legacy) +
    (editable ? '<div class="exercise-comment">' + field('comment', 'Comentario del ejercicio',
      'maxlength="600" placeholder="¿Cómo te fue?" data-exercise="' + esc(e.id) + '" data-field="comment"', e.comment) + '</div>'
      : (e.comment ? '<p class="record"><strong>Comentario del cliente</strong><br>' + esc(e.comment) + '</p>' : '')) + '</article>';
}

function workoutLog(week) {
  const days = [...new Set(week.exercises.map(e => e.day))];
  return days.map(day => '<div class="log-day"><h3>' + esc(day) + '</h3>' +
    week.exercises.filter(e => e.day === day).map(e => exercise(e)).join('') + '</div>').join('');
}
function training(c) {
  const w = c.week;
  const days = [...new Set(w.exercises.map(e => e.day))];
  const selected = days.includes(day) ? day : days[0];
  const editable = role === 'client' && w.status === 'active';
  const coachEdit = role === 'coach' && w.status === 'active';
  const { text, percent } = weeklyProgress(w);
  return '<div class="grid"><div><section class="card"><div class="card-head"><h2>Rutina asignada</h2>'+badge(w)+'</div>'+
    (editable && days.length ? '<p class="footer-note">RPE: esfuerzo percibido de 1 a 10. RIR: repeticiones que te quedaban.</p>' : '')+
    (days.length ? '<div class="day-tabs" aria-label="Días de entrenamiento">'+days.map(d => '<button data-action="day" data-value="'+esc(d)+'" aria-pressed="'+(d===selected)+'" class="'+(d===selected?'active':'')+'">'+esc(d)+'</button>').join('')+'</div><div>'+
      w.exercises.filter(e => e.day === selected).map(e => exercise(e, editable, coachEdit, editable ? previousExercise(c.history, e) : undefined)).join('')+'</div>' : empty('Aún no hay ejercicios asignados.'))+'</section></div>'+
    '<aside><div class="week-banner"><h2>Semana '+w.number+'</h2><p data-series-progress>'+text+'</p><div class="progress" role="progressbar" aria-label="Series completadas" aria-valuenow="'+percent+'"><span style="width:'+percent+'%"></span></div></div>'+
    '<section class="card"><h2>Objetivo</h2><p class="muted">'+esc(c.goal || 'Pendiente de definir')+'</p>'+btn('Ver revisión','view','',4)+'</section></aside></div>';
}
function review(c) {
  const w = c.week;
  const editable = role === 'client' && w.status === 'active';
  return '<div class="grid"><div><section class="card"><div class="card-head"><h2>Semana '+w.number+'</h2>'+badge(w)+'</div>'+
    (w.status === 'active' && w.revisionNote ? '<p class="coach-note"><strong>Corrección solicitada</strong><br>'+esc(w.revisionNote)+'</p>' : '')+
    (editable ? '<form data-form="submit" class="form-grid">'+
      field('energy','Energía (1–10)','required type="number" min="1" max="10"',w.wellbeing.energy)+
      field('sleep','Horas de sueño por noche','required type="number" min="0" max="24" step="0.5"',w.wellbeing.sleep)+
      field('adherence','Adherencia (%)','required type="number" min="0" max="100"',w.wellbeing.adherence)+
      area('notes','Notas de la semana',w.wellbeing.notes,'maxlength="1500"')+
      '<div class="full"><p class="footer-note">Al enviar, el entrenador podrá revisar tus registros en modo lectura.</p><button class="btn primary">Enviar semana</button></div></form>' :
      readReview(w)+
      (role === 'coach' && w.status === 'submitted' ? '<form data-form="approve">'+area('feedback','Comentario del entrenador','','maxlength="1500"')+
        '<div class="modal-actions">'+btn('Pedir corrección', 'return-week')+'<button class="btn primary">Aprobar semana</button></div></form>' : '')+
      (role === 'coach' && w.status === 'approved' ? '<div class="actions">'+btn('Archivar y abrir nueva semana','archive','primary')+'</div>' : ''))+'</section>'+
    '<section class="card"><h2>Registro de entrenamiento</h2><p class="muted">'+weeklyProgress(w).text+'</p>'+
    (workoutLog(w) || empty('Semana sin ejercicios.'))+'</section></div>'+
    '<aside><section class="card"><h2>Historial</h2>'+(c.history.map((h,index) => '<button class="history" data-action="history" data-value="'+index+'"><strong>Semana '+h.number+'</strong><span class="muted">'+date(h.archivedAt)+'</span></button>').join('') || '<p class="muted">Las semanas archivadas aparecerán aquí.</p>')+'</section></aside></div>';
}
function readReview(w) {
  const {energy,sleep,adherence,notes} = w.wellbeing;
  return '<div class="metric-list"><div class="metric"><span>Energía</span><strong>'+number(energy)+'/10</strong></div><div class="metric"><span>Sueño</span><strong>'+number(sleep)+' h</strong></div><div class="metric"><span>Adherencia</span><strong>'+number(adherence)+' %</strong></div></div>'+
    '<p class="record"><strong>Notas del cliente</strong><br>'+esc(notes || 'Sin notas')+'</p>'+
    (w.status === 'approved' ? '<p class="record"><strong>Comentario del entrenador</strong><br>'+esc(w.feedback || 'Sin comentario')+'</p>' : '');
}
function nutrition(c) {
  return '<section class="card"><div class="card-head"><h2>Pautas del entrenador</h2>'+btn('Ver recursos de alimentación','view','',5)+'</div>'+
    (role === 'coach' ? '<form data-form="nutrition">'+area('nutrition','Plan de alimentación',c.nutrition,'maxlength="4000"')+'<div class="modal-actions"><button class="btn primary">Guardar pautas</button></div></form>' : '<p class="record">'+esc(c.nutrition || 'El entrenador aún no ha añadido pautas.')+'</p>')+'</section>';
}
function measurements(c) {
  const rows = [...c.measurements].sort((a,b) => b.date.localeCompare(a.date));
  return '<section class="card"><h2>Registro de mediciones</h2>'+(rows.length ? '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Peso</th><th>Cintura</th></tr></thead><tbody>'+rows.map(m => '<tr><td>'+date(m.date)+'</td><td>'+number(m.weight)+' kg</td><td>'+(m.waist === ''?'—':number(m.waist)+' cm')+'</td></tr>').join('')+'</tbody></table></div>' : empty('Todavía no hay mediciones.'))+'</section>';
}
function evolution(c) {
  const records = [...c.measurements].sort((a,b) => a.date.localeCompare(b.date));
  if (!records.length) return '<section class="card">'+empty('Añade una medición para ver tu evolución.')+btn('Ver mediciones','view','',3)+'</section>';
  const weights = records.map(m => m.weight);
  const last = weights.at(-1);
  const delta = Math.round((last-weights[0])*100)/100;
  const min = Math.min(...weights)-0.2;
  const max = Math.max(...weights)+0.2;
  const points = weights.map((w,i) => [weights.length===1?200:18+i/(weights.length-1)*364,124-(w-min)/(max-min)*108]);
  return '<div class="stats">'+stat('Último peso',number(last)+' kg',date(records.at(-1).date))+stat('Cambio',(delta>0?'+':'')+number(delta)+' kg','Desde la primera medición')+stat('Mediciones',records.length,'Registros guardados')+'</div>'+
    '<section class="card"><h2>Evolución del peso</h2><svg class="chart" viewBox="0 0 400 140" role="img" aria-label="Peso registrado de '+number(weights[0])+' a '+number(last)+' kilos"><path d="M18 20H382 M18 70H382 M18 120H382" stroke="#e7e7ea"/><polyline points="'+points.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#957641" stroke-width="3"/>'+points.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="4" fill="#957641"/>').join('')+'</svg></section>';
}
function resources() {
  const library = [['video', 'Vídeos de técnica'], ['nutrition', 'Materiales de alimentación']].map(([type, label]) => {
    const items = data.resources.filter(item => item.type === type);
    return '<section class="card"><h2>' + label + '</h2>' +
      (items.map(item => '<article class="library-item"><div><h3>' + esc(item.title) + '</h3>' +
        (item.note ? '<p class="muted">' + esc(item.note) + '</p>' : '') + '</div><div class="actions">' +
        external(type === 'video' ? 'Ver vídeo' : 'Abrir material', item.link) +
        (role === 'coach' ? btn('Editar', 'edit-resource', '', item.id) : '') + '</div></article>').join('') ||
        '<p class="muted">Aún no hay recursos en esta sección.</p>') + '</section>';
  }).join('');
  return library + '<section class="card"><h2>Primeros pasos</h2><details class="resource"><summary>Registrar un entrenamiento</summary><p>Elige tu día, anota el peso, las repeticiones, el RPE y el RIR de cada serie y márcala como hecha. Usa Iniciar descanso para contar el tiempo pautado.</p></details><details class="resource"><summary>Enviar la revisión semanal</summary><p>Completa tu revisión y pulsa Enviar semana. Tu entrenador podrá comentarla, aprobarla y guardarla en tu historial.</p></details><details class="resource"><summary>Añadir la app al iPhone</summary><p>Abre la app en Safari. Pulsa Compartir y después Añadir a pantalla de inicio.</p></details></section>';
}
const captions = ['Consulta los días y los ejercicios de la rutina.','Consulta las pautas de alimentación.','Sigue los cambios a partir de las mediciones registradas.','Consulta y registra tus medidas.','Consulta lo registrado y el estado de la revisión.','Aprende a usar tu espacio de seguimiento.'];
const coachUi = { btn, esc, longDate, date, initials, badge, number, head, eventItem: eventListItem, progress: weeklyProgress };
const coachPages = { home: 'Inicio', agenda: 'Agenda', clients: 'Clientes', reviews: 'Revisiones' };

function render() {
  const c = client();
  const isHome = view === 'home' && role === 'coach';
  const isManagement = role === 'coach' && Object.hasOwn(coachPages, view);
  const isProfile = view === 'profile' && role === 'coach';
  const dashboardEnter = isHome && !dashboardVisible;
  dashboardVisible = isHome;
  const index = Number(view);
  const inClient = !isManagement && (isProfile || index < 5);
  const action = {
    0: role === 'coach' && c?.week.status === 'active' ? btn('+ Añadir ejercicio','new-exercise','primary') : '',
    3: role === 'client' ? btn('+ Nueva medición','measure','primary') : '',
    5: role === 'coach' ? btn('+ Añadir recurso','new-resource','primary') : ''
  }[index] || '';
  const coachView = {
    home: () => dashboard({ data, ui: coachUi, today: dateKey(new Date()) }),
    agenda: agendaPage,
    clients: () => clientDirectory({ data, ui: coachUi, query: clientQuery, filter: clientFilter }),
    reviews: () => reviewInbox({ data, ui: coachUi, filter: reviewFilter }),
    profile: () => clientProfile({ client: c, data, ui: coachUi, signedIn: authMode === 'google' })
  }[view];
  const content = coachView ? coachView() :
    head(index === 5 && role === 'coach' ? 'Biblioteca' : esc(c.name),sections[index],captions[index],action) +
    [training, nutrition, evolution, measurements, review, resources][index](c);
  const clientTabs = role === 'coach' && inClient
    ? '<nav class="record-nav" aria-label="Ficha del cliente">' + navButton('Ficha','profile') + sections.slice(0, 5).map(navButton).join('') + '</nav>' : '';
  const navigation = role === 'coach'
    ? Object.entries(coachPages).map(([value, label]) => navButton(label, value, view === value || (value === 'clients' && inClient), value)).join('') +
      navButton('Recursos', '5', view === '5', 'resources')
    : sections.map(navButton).join('');
  const breadcrumb = isManagement ? coachPages[view] : isProfile ? esc(c.name) :
    (inClient ? esc(c.name) + ' / ' : '') + sections[index];
  const account = session ? '<span class="account-role">' + (role === 'coach' ? 'Administrador' : 'Cliente') + '</span>' +
    btn('Salir', 'sign-out') : '<select aria-label="Vista de demostración" id="role"><option value="coach" '+(role==='coach'?'selected':'')+'>Vista entrenador</option><option value="client" '+(role==='client'?'selected':'')+'>Vista cliente</option></select>';
  app.innerHTML = '<div class="shell' + (role === 'coach' ? ' dashboard-shell' : '') + '"><aside class="sidebar"><div class="brand">' + brandLockup + '</div><div class="mobile-brand">' + brandLockup + '</div>'+
    '<p class="nav-label">SEGUIMIENTO</p><nav class="nav" aria-label="Secciones">'+navigation+'</nav><div class="sidebar-foot"><strong>David Llanos · Coaching</strong><small>'+
    (session ? esc(session.email) : 'Demo · Datos de este navegador')+'</small></div></aside>'+
    '<div class="main"><header class="topbar"><div class="crumb">Coaching / '+breadcrumb+'</div><div class="role">'+account+
    (inClient && (!session || role === 'coach') ? '<select id="client" aria-label="Cliente">'+data.clients.map(item => '<option value="'+esc(item.id)+'" '+(item.id===clientId?'selected':'')+'>'+esc(item.name)+'</option>').join('')+'</select>' : '')+'</div></header>'+
    '<main class="content' + (role === 'coach' ? ' dashboard' : '') + (dashboardEnter ? ' dashboard-enter' : '') + '">' +
    clientTabs + content + '</main></div></div>';
  for (const active of app.querySelectorAll('.nav button.active, .record-nav button.active')) {
    const nav = active.parentElement;
    if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - 12);
  }
  updateRest();
}
function navButton(label,value, current, icon = '') {
  const active = typeof current === 'boolean' ? current : String(value) === view;
  return '<button type="button" class="'+(active?'active':'')+'" '+(active?'aria-current="page" ':'')+'data-action="view" data-value="'+value+'">'+
    (icon ? '<span class="workspace-icon icon-' + icon + '" aria-hidden="true"></span>' : '') + label + '</button>';
}
function dialog(title, body, kind, label = 'Guardar', id = '') {
  modal.innerHTML = '<form data-form="'+kind+'" data-id="'+esc(id)+'"><h2 id="dialog-title">'+title+'</h2><div class="form-grid">'+body+'</div><div class="modal-actions">'+btn(label?'Cancelar':'Cerrar','close')+(label?'<button class="btn primary">'+label+'</button>':'')+'</div></form>';
  if (!modal.open) modal.showModal();
}
function exerciseDialog(id) {
  const e = client().week.exercises.find(item => item.id === id);
  dialog(e?'Editar ejercicio':'Añadir ejercicio',
    field('day','Día','required maxlength="80" placeholder="Día 1 · Tren inferior"',e?.day || day || client().week.exercises[0]?.day)+
    field('name','Ejercicio','required maxlength="100"',e?.name)+
    field('setCount','Número de series','required type="number" min="1" max="'+maxSets+'" step="1" inputmode="numeric"',e?.sets.length ?? 3)+
    field('targetReps','Repeticiones objetivo por serie','required maxlength="40" placeholder="10 o 8–12"',e?.targetReps)+
    field('restSeconds','Descanso (segundos)','type="number" min="0" max="3600" step="1" inputmode="numeric"',e?.restSeconds || '')+
    field('target','Carga objetivo (kg)','type="number" min="0" max="999" step="any" inputmode="decimal"',e?.target)+
    selectField('videoId','Vídeo de técnica', [['', 'Sin vídeo'], ...data.resources.filter(item => item.type === 'video').map(item => [item.id, item.title])], e?.videoId)+
    area('coachNote','Indicaciones para el cliente',e?.coachNote,'maxlength="800" placeholder="Ej. Baja lento y mantén la técnica."'),
    'exercise','Guardar ejercicio',e?.id);
}

function eventDialog(entry) {
  dialog(entry ? 'Editar cita' : 'Nueva cita',
    selectField('type', 'Tipo', Object.entries(eventTypes), entry?.type) +
    selectField('clientId', 'Cliente', data.clients.map(item => [item.id, item.name]), entry?.clientId || clientId) +
    field('date', 'Fecha', 'required type="date"', entry?.date || agendaDate) +
    field('time', 'Hora', 'required type="time"', entry?.time || '10:00') +
    field('duration', 'Duración (minutos)', 'required type="number" min="5" max="480" step="1" inputmode="numeric"', entry?.duration ?? 30) +
    selectField('reminder', 'Aviso en el calendario', [['0', 'Sin aviso'], ['15', '15 minutos antes'], ['60', '1 hora antes'], ['1440', '1 día antes']], entry?.reminder ?? 15) +
    '<div class="full">' + field('link', 'Enlace de la llamada', 'type="url" maxlength="1000" placeholder="https://…"', entry?.link) + '</div>' +
    area('notes', 'Notas privadas de la cita', entry?.notes, 'maxlength="800"'),
    'event', 'Guardar cita', entry?.id);
}

function eventDetails(entry) {
  const assigned = data.clients.find(item => item.id === entry.clientId);
  const message = eventMessage(entry, assigned);
  const email = encodeURIComponent(assigned.email).replace('%40', '@');
  const mailto = 'mailto:' + email + '?subject=' + encodeURIComponent(eventTypes[entry.type] + ' · David Llanos Coaching') + '&body=' + encodeURIComponent(message);
  const id = entry.id;
  dialog(esc(eventTypes[entry.type] + ' · ' + assigned.name),
    '<div class="full"><p class="agenda-heading"><strong>' + longDate(entry.date) + ' · ' + esc(entry.time) + '</strong><br>' +
    entry.duration + ' min' + ((entry.cancelled || entry.completed) ? ' · ' + appointmentStatus(entry) : '') + '</p>' +
    (entry.notes ? '<p class="record">' + esc(entry.notes) + '</p>' : '') +
    '<div class="actions">' + btn('Editar cita', 'edit-event', '', id) +
    (entry.completed ? '' : btn(entry.cancelled ? 'Reactivar cita' : 'Cancelar cita', 'toggle-event', '', id)) +
    (!entry.cancelled ? btn(entry.completed ? 'Reabrir cita' : 'Marcar realizada', 'complete-event', '', id) : '') +
    (!entry.cancelled && !entry.completed ? btn('Añadir a mi calendario', 'export-event', '', id) + external('Abrir enlace', entry.link) : '') +
    (entry.type === 'review' && !entry.cancelled ? btn('Ver revisión semanal', 'open-review', '', assigned.id) : '') +
    '</div>' +
    (!entry.cancelled && !entry.completed ? '<div class="appointment-message">' + area('message', 'Mensaje para el cliente', message, 'id="event-message" readonly') +
      '<div class="actions">' + btn('Copiar mensaje', 'copy-message', '', id) +
      '<a class="btn" href="' + esc(mailto) + '">Abrir borrador de correo</a></div></div>' : '') + '</div>',
    'event-details', '');
}

function resourceDialog(item) {
  dialog(item ? 'Editar recurso' : 'Añadir recurso',
    selectField('type', 'Tipo', Object.entries(resourceTypes), item?.type) +
    field('title', 'Título', 'required maxlength="120"', item?.title) +
    '<div class="full">' + field('link', 'Enlace de vídeo o material', 'required type="url" maxlength="1000" placeholder="https://…"', item?.link) + '</div>' +
    area('note', 'Descripción', item?.note, 'maxlength="500"'),
    'resource', 'Guardar recurso', item?.id);
}

function clientDialog(item) {
  dialog(item ? 'Editar ficha' : 'Nuevo cliente',
    field('name', 'Nombre', 'required maxlength="100"', item?.name) +
    field('email', 'Correo electrónico', 'required type="email" maxlength="200"', item?.email) +
    area('goal', 'Objetivo', item?.goal, 'maxlength="300"') +
    area('coachNotes', 'Notas privadas del entrenador', item?.coachNotes, 'maxlength="2000"'),
    'client', item ? 'Guardar ficha' : 'Crear ficha', item?.id);
}

function invitationDialog(item) {
  const address = encodeURIComponent(item.email).replace('%40', '@');
  const invite = 'Hola, ' + item.name + '.\n\nYa tienes acceso a David Llanos Coaching. Entra en ' +
    location.origin + '/ con la cuenta de Google ' + item.email + '.';
  const email = 'mailto:' + address + '?subject=' + encodeURIComponent('Tu acceso a David Llanos Coaching') + '&body=' + encodeURIComponent(invite);
  dialog('Compartir invitación', '<div class="full"><p>El acceso está habilitado para <strong>' + esc(item.email) +
    '</strong>.</p>' + area('message', 'Mensaje de invitación', invite, 'id="event-message" readonly') +
    '<div class="actions appointment-message">' + btn('Copiar mensaje', 'copy-message') +
    '<a class="btn primary" href="' + esc(email) + '">Abrir borrador de correo</a></div></div>', 'event-details', '');
}

function historyDialog(week) {
  dialog('Semana ' + week.number,
    '<div class="full">' + readReview(week) + '<h3>Entrenamiento</h3>' + workoutLog(week) + '</div>', 'history', '');
}

function refreshAgenda(animated = true) {
  app.querySelector('.agenda-grid').outerHTML = calendarPanel();
  const agenda = app.querySelector('.agenda-grid');
  if (animated) agenda.querySelector('.agenda-date-card').classList.add('agenda-reveal');
  return agenda;
}

function filterWorkspace(key, value) {
  if (key === 'client-filter') clientFilter = value;
  else reviewFilter = value;
  render();
  [...app.querySelectorAll('[data-action="' + key + '"]')].find(control => control.dataset.value === value)?.focus({ preventScroll: true });
}

function exportAppointment(entry) {
  const assigned = data.clients.find(item => item.id === entry.clientId);
  const blob = new Blob([eventCalendar(entry, assigned)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'David-Llanos-' + entry.date + '.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

async function copyAppointment() {
  const message = modal.querySelector('#event-message');
  try {
    await navigator.clipboard.writeText(message.value);
    notify('Mensaje copiado');
  } catch {
    message.focus();
    message.select();
    notify('Selecciona Copiar en tu dispositivo.');
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const {action,value} = button.dataset;
  const c = client();
  switch (action) {
    case 'email-login':
      showEmailLogin();
      break;
    case 'login-options':
      emailLoginToken = '';
      showLogin();
      break;
    case 'sign-out':
      try {
        await pendingSave;
        const response = await fetch('/api/logout', { method: 'POST' });
        if (!response.ok) throw Error('No se pudo cerrar sesión.');
        location.reload();
      } catch (error) { notify(error.message); }
      break;
    case 'view': navigate(value); break;
    case 'close': modal.close(); break;
    case 'open-client':
    case 'open-review':
      if (modal.open) modal.close();
      clientId = value;
      navigate(action === 'open-review' ? '4' : 'profile');
      break;
    case 'client-filter':
    case 'review-filter': filterWorkspace(action, value); break;
    case 'client-filter-view':
      clientFilter = value;
      clientQuery = '';
      navigate('clients');
      break;
    case 'review-filter-view':
      reviewFilter = value;
      navigate('reviews');
      break;
    case 'review-history': {
      const owner = data.clients.find(item => item.id === value);
      const week = owner?.history[Number(button.dataset.index)];
      if (week) historyDialog(week);
      break;
    }
    case 'open-agenda-day':
      agendaDate = value;
      agendaFilter = 'all';
      navigate('agenda');
      break;
    case 'agenda-day':
    case 'agenda-month':
    case 'agenda-today': {
      if (action === 'agenda-month') agendaDate = shiftMonth(agendaDate.slice(0, 7), Number(value)) + '-01';
      else agendaDate = action === 'agenda-today' ? dateKey(new Date()) : value;
      const agenda = refreshAgenda();
      if (action !== 'agenda-day') agenda.querySelector('.calendar-days').classList.add('agenda-reveal');
      const controls = agenda.querySelectorAll('[data-action="' + action + '"]');
      [...controls].find(control => control.dataset.value === value)?.focus({ preventScroll: true });
      break;
    }
    case 'new-event': eventDialog(); break;
    case 'show-event':
    case 'edit-event':
    case 'toggle-event':
    case 'complete-event':
    case 'export-event': {
      const entry = data.agenda.find(item => item.id === value);
      if (!entry) break;
      if (action === 'show-event') eventDetails(entry);
      if (action === 'edit-event') eventDialog(entry);
      if (action === 'export-event' && !entry.cancelled && !entry.completed) exportAppointment(entry);
      const state = action === 'toggle-event' ? 'cancelled' : action === 'complete-event' ? 'completed' : '';
      if (state && await commit(next => {
        next.agenda.find(item => item.id === value)[state] = !entry[state];
      })) {
        render();
        eventDetails(data.agenda.find(item => item.id === value));
        notify(state === 'completed' ? (entry.completed ? 'Cita reabierta' : 'Cita realizada') :
          (entry.cancelled ? 'Cita reactivada' : 'Cita cancelada'));
      }
      break;
    }
    case 'copy-message': void copyAppointment(); break;
    case 'new-resource': resourceDialog(); break;
    case 'edit-resource': resourceDialog(data.resources.find(item => item.id === value)); break;
    case 'day': {
      day = value;
      render();
      [...app.querySelectorAll('[data-action="day"]')].find(el => el.dataset.value === value)?.focus();
      break;
    }
    case 'new-client': clientDialog(); break;
    case 'edit-client': clientDialog(c); break;
    case 'invite-client':
      if (role === 'coach' && session && (c.accessEnabled || await commit((_, item) => { item.accessEnabled = true; }))) {
        render();
        invitationDialog(client());
      }
      break;
    case 'revoke-access':
      if (role === 'coach' && session) dialog('Revocar acceso',
        '<p class="full">La cuenta de ' + esc(c.name) + ' perderá acceso. Su ficha y el historial seguirán guardados.</p>',
        'revoke-access', 'Revocar acceso');
      break;
    case 'return-week':
      dialog('Pedir corrección', area('reason', '¿Qué debe corregir el cliente?', '', 'required maxlength="1500"'), 'return-week', 'Devolver semana');
      break;
    case 'new-exercise': exerciseDialog(); break;
    case 'edit-exercise': exerciseDialog(value); break;
    case 'rest': {
      const exercise = c.week.exercises.find(item => item.id === value);
      if (role === 'client' && c.week.status === 'active' && exercise?.restSeconds) toggleRest(exercise);
      break;
    }
    case 'measure': {
      const today = new Date();
      const dateValue = new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
      dialog('Nueva medición',field('date','Fecha','required type="date" max="'+dateValue+'"',dateValue)+field('weight','Peso (kg)','required type="number" min="1" max="999" step="any"')+field('waist','Cintura (cm)','type="number" min="1" max="400" step="any"'),'measure');
      break;
    }
    case 'archive':
      dialog('Archivar semana '+c.week.number,'<p class="full">La revisión y los registros quedarán en el historial. La próxima semana mantendrá los ejercicios y empezará con los registros en blanco.</p>','archive','Archivar y continuar');
      break;
    case 'history': {
      const w = c.history[Number(value)];
      historyDialog(w);
      break;
    }
  }
});
document.addEventListener('input', async event => {
  const el = event.target;
  if (el.id === 'search') {
    clientQuery = el.value;
    document.querySelector('#clients').innerHTML = directoryRows(data, coachUi, clientQuery, clientFilter);
  }
  if (el.dataset.exercise && role === 'client' && client().week.status === 'active') {
    if (!el.validity.valid) return;
    const { field, set } = el.dataset;
    const value = field === 'done' ? el.checked : el.value;
    const saved = await commit((_,c) => {
      const e = c.week.exercises.find(item => item.id === el.dataset.exercise);
      if (field === 'comment') e.comment = value;
      else e.sets[Number(set)][field] = value;
    });
    if (saved && field === 'done' && el.isConnected) {
      const { text, percent } = weeklyProgress(client().week);
      const progress = app.querySelector('.progress');
      app.querySelector('[data-series-progress]').textContent = text;
      progress.setAttribute('aria-valuenow', percent);
      progress.firstElementChild.style.width = percent+'%';
    }
    if (!saved && field === 'done') el.checked = !el.checked;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'agenda-filter') {
    agendaFilter = event.target.value;
    refreshAgenda();
  }
  if (event.target.id === 'role' && authMode === 'demo') {
    stopRest();
    role = event.target.value;
    navigate(role === 'coach' ? 'home' : '0');
  }
  if (event.target.id === 'client') {
    stopRest();
    clientId = event.target.value;
    navigate(view);
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (form.dataset.form === 'request-email' || form.dataset.form === 'confirm-email') {
    await submitEmailLogin(form);
    return;
  }
  const values = Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,v.trim()]));
  let nextClientId = clientId;
  const kind = form.dataset.form;
  if (kind === 'event-details' || kind === 'history' || form.dataset.saving) return;
  form.dataset.saving = 'true';
  const saved = await commit((next,c) => {
    switch (kind) {
      case 'client': {
        if (!values.name) throw Error('Escribe el nombre del cliente.');
        const existing = next.clients.find(item => item.id === form.dataset.id);
        if (next.clients.some(item => item.id !== existing?.id && item.email.toLowerCase() === values.email.toLowerCase())) throw Error('Ya existe una ficha con ese correo.');
        if (existing) {
          Object.assign(existing, values);
          nextClientId = existing.id;
          break;
        }
        const week = freshWeek(c?.week.number);
        nextClientId = uid();
        next.clients.push({id:nextClientId,...values,week,history:[],measurements:[],nutrition:''});
        break;
      }
      case 'exercise': {
        if (role !== 'coach' || c.week.status !== 'active') throw Error('La rutina de esta semana está cerrada.');
        if (![values.day, values.name, values.setCount, values.targetReps].every(Boolean)) throw Error('Completa los datos del ejercicio.');
        const index = c.week.exercises.findIndex(item => item.id === form.dataset.id);
        const existing = c.week.exercises[index];
        const plan = {
          ...values,
          restSeconds: Number(values.restSeconds),
          restNote: values.restSeconds === '' ? existing?.restNote || '' : ''
        };
        if (existing) c.week.exercises[index] = updateExercise(existing, plan);
        else c.week.exercises.push(createExercise(plan));
        break;
      }
      case 'event': {
        if (role !== 'coach') throw Error('Solo el entrenador puede editar la agenda.');
        const index = next.agenda.findIndex(item => item.id === form.dataset.id);
        const entry = {
          ...next.agenda[index], ...values, id: next.agenda[index]?.id || uid(),
          link: webLink(values.link), duration: Number(values.duration), reminder: Number(values.reminder)
        };
        if (index === -1) next.agenda.push(entry);
        else next.agenda[index] = entry;
        break;
      }
      case 'resource': {
        if (role !== 'coach') throw Error('Solo el entrenador puede editar los recursos.');
        if (!values.title) throw Error('Escribe un título.');
        const index = next.resources.findIndex(item => item.id === form.dataset.id);
        const item = { ...values, id: next.resources[index]?.id || uid(), link: webLink(values.link) };
        if (index === -1) next.resources.push(item);
        else next.resources[index] = item;
        break;
      }
      case 'measure': {
        const entry = {date:values.date,weight:Number(values.weight),waist:values.waist ? Number(values.waist) : ''};
        c.measurements = c.measurements.filter(m => m.date !== entry.date).concat(entry);
        break;
      }
      case 'nutrition': c.nutrition = values.nutrition; break;
      case 'submit':
        c.week.wellbeing = {energy:Number(values.energy),sleep:Number(values.sleep),adherence:Number(values.adherence),notes:values.notes};
        submitWeek(c);
        break;
      case 'approve': approveWeek(c,values.feedback); break;
      case 'return-week': returnWeek(c,values.reason); break;
      case 'revoke-access': c.accessEnabled = false; break;
      case 'archive': archiveWeek(c); break;
    }
  });
  delete form.dataset.saving;
  if (!saved) return;
  if (kind === 'submit') stopRest();
  if (modal.open) modal.close();
  clientId = nextClientId;
  if (kind === 'client') navigate('profile');
  else {
    if (kind === 'exercise') day = values.day;
    if (kind === 'event') agendaDate = values.date;
    render();
  }
  notify({client:'Ficha guardada',exercise:'Rutina guardada',measure:'Medición guardada',nutrition:'Pautas guardadas',submit:'Semana enviada',approve:'Semana aprobada','return-week':'Semana devuelta para corregir',archive:'Semana archivada. La siguiente ya está abierta.',event:'Cita guardada',resource:'Recurso guardado','revoke-access':'Acceso revocado'}[kind]);
});

function accessScreen(title, message, action = '') {
  app.innerHTML = '<main class="access-screen"><section class="access-card" aria-labelledby="access-title">' +
    '<img class="access-mark" src="./icon-192.png" alt="David Llanos Coaching" width="76" height="76">' +
    '<h1 id="access-title" tabindex="-1">' + title + '</h1><p class="access-description">' + message + '</p>' + action +
    '</section><footer class="access-footer"><a href="./privacidad.html">Política de privacidad</a>' +
    '<a href="./terminos.html">Términos de uso</a></footer></main>';
}

function showLogin(message = 'Accede a tu rutina, tus revisiones y el seguimiento con tu entrenador.') {
  accessScreen('Inicia sesión', message, '<div class="access-actions">' +
    '<a class="btn access-google" href="/api/auth/google"><img src="./google-g.png" width="20" height="20" alt="">Continuar con Google</a>' +
    btn('<span class="access-envelope" aria-hidden="true"></span>Continuar con email', 'email-login', 'access-email') +
    '</div><p class="access-invite">Usa el correo al que te invitó tu entrenador.</p>');
}

function showEmailLogin() {
  const back = btn('Volver a las opciones de acceso', 'login-options', 'access-back');
  if (!emailLoginEnabled) {
    accessScreen('Continúa con email', 'El envío de enlaces por correo todavía no está habilitado. Si tienes cuenta de Google, puedes usarla para entrar.', back);
  } else {
    accessScreen('Continúa con email', 'Te enviaremos un enlace si tu correo tiene acceso.', 
      '<form class="email-login-form" data-form="request-email"><label>Correo electrónico' +
      '<input name="email" required type="email" maxlength="254" autocomplete="email" inputmode="email" autocapitalize="none" placeholder="tu@correo.com"></label>' +
      '<p class="access-feedback" role="status"></p><button class="btn access-commit">Enviar enlace</button></form>' + back);
  }
  app.querySelector('#access-title').focus({ preventScroll: true });
}

function showEmailConfirmation() {
  accessScreen('Confirma tu acceso', 'Pulsa entrar para usar el enlace que recibiste en tu correo.',
    '<form class="email-login-form" data-form="confirm-email"><p class="access-feedback" role="status"></p>' +
    '<button class="btn access-commit">Entrar</button></form>' + btn('Volver a las opciones de acceso', 'login-options', 'access-back'));
}

async function submitEmailLogin(form) {
  const button = form.querySelector('button');
  const feedback = form.querySelector('[role="status"]');
  if (button.disabled) return;
  button.disabled = true;
  const confirm = form.dataset.form === 'confirm-email';
  const path = confirm ? '/api/auth/email/confirm' : '/api/auth/email';
  const payload = confirm ? { token: emailLoginToken } : { email: new FormData(form).get('email') };
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    if (confirm) {
      emailLoginToken = '';
      location.reload();
    } else {
      accessScreen('Revisa tu correo', 'Si el correo tiene acceso, recibirás un enlace válido durante 15 minutos.',
        btn('Volver a las opciones de acceso', 'login-options', 'access-back'));
      app.querySelector('#access-title').focus({ preventScroll: true });
    }
  } catch (error) {
    feedback.textContent = error.message || 'No se pudo completar el acceso. Vuelve a intentarlo.';
    button.disabled = false;
  }
}

async function start() {
  const modeKey = key + '-auth-mode';
  try {
    const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (response.status === 404 && localStorage.getItem(modeKey) !== 'google') {
      authMode = 'demo';
      render();
      return;
    }
    if (!response.ok) throw Error('No se pudo consultar la sesión.');
    const result = await response.json();
    authMode = result.mode;
    if (authMode === 'google') {
      localStorage.setItem(modeKey, 'google');
      emailLoginEnabled = result.emailLogin === true;
      session = result.user || null;
      const linkToken = new URLSearchParams(location.hash.slice(1)).get('acceso-email');
      if (linkToken) {
        history.replaceState(null, '', location.pathname + location.search);
        if (emailLoginEnabled && /^[A-Za-z0-9_-]{43}$/.test(linkToken)) {
          emailLoginToken = linkToken;
          showEmailConfirmation();
          return;
        }
      }
      if (!session) {
        const outcome = new URL(location.href).searchParams.get('access');
        const message = {
          invite: 'Esta cuenta no tiene acceso. Entra con el correo al que te invitó el entrenador.',
          failed: 'No se pudo verificar la sesión con Google. Prueba otra vez.',
          cancelled: 'El inicio de sesión no se completó.'
        }[outcome];
        if (outcome) history.replaceState(null, '', location.pathname);
        showLogin(message);
        return;
      }
      data = result.data;
      revision = result.revision;
      role = session.role;
      clientId = session.clientId || data.clients[0]?.id;
      view = role === 'coach' ? 'home' : '0';
    } else {
      authMode = 'demo';
      localStorage.setItem(modeKey, 'demo');
    }
    render();
  } catch {
    if (!navigator.onLine && localStorage.getItem(modeKey) === 'demo') {
      authMode = 'demo';
      render();
      return;
    }
    accessScreen('No se pudo conectar', 'Recarga la página para conectar con el servidor.',
      '<a class="btn access-commit" href="/">Volver a intentar</a>');
  }
}
void start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
