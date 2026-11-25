import { dateKey, localDate, eventTypes } from './agenda.js';

const dayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);

export function weekDays(date) {
  const monday = localDate(date);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + index);
    return dateKey(day);
  });
}

export function upcomingEvents(agenda, now = new Date()) {
  const date = dateKey(now);
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return agenda.filter(item => !item.cancelled && !item.completed &&
    (item.date > date || (item.date === date && item.time >= time)))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export const directoryFilters = {
  all: 'Todos', active: 'En curso', submitted: 'Por revisar',
  approved: 'Aprobados', unassigned: 'Sin rutina'
};
export const inboxFilters = { submitted: 'Por revisar', approved: 'Por archivar', archived: 'Historial' };
const normalize = value => value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function filteredClients(clients, query, filter) {
  const match = normalize(query.trim());
  return clients.filter(client => {
    const state = client.week.status === 'active' && !client.week.exercises.length ? 'unassigned' : client.week.status;
    return (filter === 'all' || filter === state) && normalize(client.name + ' ' + client.email).includes(match);
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function controls(filters, selected, action, btn) {
  return '<div class="workspace-filters" aria-label="Filtros">' + Object.entries(filters).map(([value, label]) =>
    btn(label, action, value === selected ? 'selected' : '', value)
      .replace('type="button"', 'type="button" aria-pressed="' + (value === selected) + '"')
  ).join('') + '</div>';
}

export function dashboard({ data, ui, today }) {
  const { btn, esc, longDate, eventItem, progress } = ui;
  const pending = data.clients.filter(client => client.week.status === 'submitted');
  const approved = data.clients.filter(client => client.week.status === 'approved');
  const days = weekDays(today);
  const weekly = data.agenda.filter(item => !item.cancelled && days.includes(item.date));
  const todayItems = weekly.filter(item => item.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const next = upcomingEvents(data.agenda).find(item => item.date > today);
  const attention = [...pending, ...approved].slice(0, 4);
  const unset = data.clients.filter(client => client.week.status === 'active' && !client.week.exercises.length);
  const metrics = [
    ['Clientes', data.clients.length, 'Fichas de seguimiento', 'clients'],
    ['Por revisar', pending.length, 'Semanas enviadas', 'reviews'],
    ['Citas esta semana', weekly.length, 'Agenda del entrenador', 'agenda']
  ];
  const cadence = days.map(day => {
    const entries = weekly.filter(item => item.date === day);
    return '<button class="week-tile' + (day === today ? ' current' : '') + '" data-action="open-agenda-day" data-value="' + day +
      '" aria-label="' + esc(longDate(day)) + ', ' + entries.length + (entries.length === 1 ? ' cita' : ' citas') + '">' +
      '<span>' + capitalize(dayFormat.format(localDate(day))) + '</span><strong>' + Number(day.slice(-2)) +
      '</strong><small>' + (entries.length ? entries.length + (entries.length === 1 ? ' cita' : ' citas') : 'Libre') + '</small></button>';
  }).join('');
  const actions = attention.map(client => '<button class="work-row" data-action="open-review" data-value="' + esc(client.id) + '">' +
    '<span class="work-marker ' + (client.week.status === 'approved' ? 'approved' : '') + '" aria-hidden="true"></span>' +
    '<span><strong>' + esc(client.name) + '</strong><small>Semana ' + client.week.number + ' · ' + progress(client.week).text + '</small></span>' +
    '<span class="badge">' + (client.week.status === 'approved' ? 'Archivar' : 'Revisar') + '</span></button>');
  if (unset.length) actions.push('<button class="work-row" data-action="client-filter-view" data-value="unassigned"><span class="work-marker neutral" aria-hidden="true"></span>' +
    '<span><strong>Clientes sin rutina</strong><small>Prepara su primera semana</small></span><span class="badge gray">' + unset.length + '</span></button>');
  return '<section class="dashboard-hero"><div class="hero-orbit" aria-hidden="true"></div><div class="hero-intro">' +
    '<p class="hero-date">' + esc(capitalize(longDate(today))) + '</p><h1 tabindex="-1">Inicio</h1>' +
    '<p class="hero-description">Organiza las citas y el seguimiento de tus clientes.</p><div class="actions">' +
    btn('+ Nueva cita', 'new-event', 'hero-primary') + btn('+ Nuevo cliente', 'new-client', 'hero-secondary') + '</div></div>' +
    '<div class="hero-metrics" aria-label="Resumen de seguimiento">' + metrics.map(([label, value, hint, view]) => {
      const action = view === 'reviews' ? 'review-filter-view' : 'view';
      const destination = view === 'reviews' ? 'submitted' : view;
      return '<button class="stat" data-action="' + action + '" data-value="' + destination + '"><span class="label">' +
        label + '</span><strong class="value">' + value + '</strong><span class="hint">' + hint + '</span></button>';
    }).join('') + '</div></section>' +
    '<div class="workspace-grid"><section class="card glass-panel"><div class="card-head"><div><h2>Agenda semanal</h2><p class="module-caption">' +
    shortDate.format(localDate(days[0])) + ' – ' + shortDate.format(localDate(days[6])) + '</p></div>' + btn('Abrir calendario', 'view', '', 'agenda') +
    '</div><div class="week-strip">' + cadence + '</div><div class="dashboard-events"><h3>Hoy</h3>' +
    (todayItems.length ? todayItems.map(item => eventItem(item)).join('') : '<p class="muted">Sin citas para hoy.</p>') +
    (next ? '<h3>Próxima cita</h3>' + eventItem(next, true) : '') + '</div></section>' +
    '<section class="card glass-panel"><div class="card-head"><h2>Por atender</h2>' + btn('Ver revisiones', 'view', '', 'reviews') + '</div>' +
    (actions.join('') || '<div class="workspace-empty"><strong>Todo al día</strong><p>Las revisiones y las rutinas sin asignar aparecerán aquí.</p></div>') +
    '</section></div>' + trainingOverview(data, ui);
}

function trainingOverview(data, { btn, esc, initials, progress }) {
  const clients = data.clients.map(client => ({ client, ...progress(client.week) }));
  const done = clients.reduce((sum, item) => sum + item.done, 0);
  const total = clients.reduce((sum, item) => sum + item.total, 0);
  const percent = total ? Math.round(done / total * 100) : 0;
  const active = clients.filter(item => item.total).sort((a, b) => b.percent - a.percent).slice(0, 4);
  return '<section class="card glass-panel activity-card"><div class="card-head"><div><h2>Seguimiento de entrenamientos</h2>' +
    '<p class="module-caption">Semanas actuales de tus clientes</p></div>' + btn('Abrir clientes', 'view', '', 'clients') + '</div>' +
    '<div class="activity-layout"><div class="activity-summary"><div class="activity-ring" style="--progress:' + percent + '%" aria-hidden="true"><strong>' +
    percent + '%</strong></div><div><strong>' + done + ' de ' + total + ' series</strong><small>Completadas · ' + percent + '%</small></div></div>' +
    '<div>' + (active.map(({ client, done, total, percent }) =>
      '<button class="activity-row" data-action="open-client" data-value="' + esc(client.id) + '"><span class="avatar">' +
      esc(initials(client.name)) + '</span><span><strong>' + esc(client.name) + '</strong><span class="client-meter" aria-hidden="true"><i style="width:' +
      percent + '%"></i></span></span><small>' + done + ' / ' + total + '</small></button>'
    ).join('') || '<p class="muted">El progreso aparecerá cuando asignes una rutina.</p>') + '</div></div></section>';
}

export function clientDirectory({ data, ui, query, filter }) {
  const { btn, esc, head } = ui;
  return head('Gestión de clientes', 'Clientes', 'Consulta las fichas y el estado de cada semana.', btn('+ Nuevo cliente', 'new-client', 'primary')) +
    '<section class="card glass-panel directory-card"><div class="directory-controls">' +
    '<label class="directory-search">Buscar por nombre o correo<input type="search" id="search" value="' + esc(query) + '" placeholder="Buscar cliente"></label>' +
    controls(directoryFilters, filter, 'client-filter', btn) + '</div><div id="clients">' +
    directoryRows(data, ui, query, filter) + '</div></section>';
}

export function directoryRows(data, { esc, initials, progress, badge }, query, filter) {
  const matches = filteredClients(data.clients, query, filter);
  const rows = matches.map(client => {
    const activity = progress(client.week);
    const noRoutine = client.week.status === 'active' && !client.week.exercises.length;
    return '<button class="directory-row" data-action="open-client" data-value="' + esc(client.id) + '">' +
      '<span class="avatar">' + esc(initials(client.name)) + '</span><span class="directory-name"><strong>' + esc(client.name) + '</strong>' +
      '<small>' + esc(client.email) + '</small></span><span class="directory-progress"><span>' + activity.text + '</span>' +
      '<span class="client-meter" aria-hidden="true"><i style="width:' + activity.percent + '%"></i></span></span>' +
      (noRoutine ? '<span class="badge gray">Sin rutina</span>' : badge(client.week)) + '</button>';
  }).join('');
  return '<p class="directory-count" role="status">' + matches.length + (matches.length === 1 ? ' cliente' : ' clientes') + '</p>' +
    (rows || '<div class="workspace-empty"><strong>No hay coincidencias</strong><p>Prueba con otro filtro o nombre.</p></div>');
}

export function reviewInbox({ data, ui, filter }) {
  const { btn, esc, head, progress, date } = ui;
  const counts = {
    submitted: data.clients.filter(c => c.week.status === 'submitted').length,
    approved: data.clients.filter(c => c.week.status === 'approved').length,
    archived: data.clients.reduce((sum, c) => sum + c.history.length, 0)
  };
  const filters = Object.fromEntries(Object.entries(inboxFilters).map(([key, label]) => [key, label + ' · ' + counts[key]]));
  const entries = filter === 'archived'
    ? data.clients.flatMap(client => client.history.map((week, index) => ({ client, week, index })))
      .sort((a, b) => (b.week.archivedAt || '').localeCompare(a.week.archivedAt || ''))
    : data.clients.filter(client => client.week.status === filter).map(client => ({ client, week: client.week }))
      .sort((a, b) => (a.week.submittedAt || '').localeCompare(b.week.submittedAt || ''));
  const rows = entries.map(({ client, week, index }) => {
    const stamp = filter === 'archived' ? week.archivedAt : week.submittedAt;
    return '<button class="inbox-row" data-action="' + (index === undefined ? 'open-review' : 'review-history') +
      '" data-value="' + esc(client.id) + '"' + (index === undefined ? '' : ' data-index="' + index + '"') + '>' +
      '<span><strong>' + esc(client.name) + '</strong><small>Semana ' + week.number +
      (stamp ? ' · ' + date(stamp) : '') + '</small></span><span>' + progress(week).text + '</span>' +
      '<span class="badge">' + (filter === 'archived' ? 'Archivada' : filter === 'approved' ? 'Aprobada' : 'Enviada') + '</span></button>';
  }).join('');
  return head('Seguimiento semanal', 'Revisiones', 'Atiende las semanas enviadas y consulta el historial.') +
    '<section class="card glass-panel">' + controls(filters, filter, 'review-filter', btn) +
    (rows || '<div class="workspace-empty"><strong>' + ({
      submitted: 'No hay revisiones por atender', approved: 'No hay semanas por archivar', archived: 'Aún no hay semanas archivadas'
    })[filter] + '</strong></div>') + '</section>';
}

export function clientProfile({ client, data, ui, signedIn }) {
  const { btn, esc, initials, badge, progress, eventItem, number } = ui;
  const activity = progress(client.week);
  const latest = [...client.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  const next = upcomingEvents(data.agenda).find(item => item.clientId === client.id);
  return '<section class="card glass-panel profile-lead"><div class="profile-name"><span class="avatar">' + esc(initials(client.name)) +
    '</span><div><h1 tabindex="-1">' + esc(client.name) + '</h1><p>' + esc(client.email) + '</p></div></div>' +
    '<div class="actions">' + btn('Editar ficha', 'edit-client') + btn('Programar cita', 'new-event', 'primary') + '</div></section>' +
    '<div class="workspace-grid"><section class="card glass-panel"><div class="card-head"><h2>Semana ' + client.week.number +
    '</h2>' + badge(client.week) + '</div><div class="profile-progress"><strong>' + activity.percent + '%</strong><span>' +
    activity.text + '</span></div><span class="client-meter"><i style="width:' + activity.percent + '%"></i></span><div class="actions profile-actions">' +
    btn('Ver rutina', 'view', '', '0') + btn('Revisión semanal', 'view', '', '4') + '</div></section>' +
    '<section class="card glass-panel"><h2>Próxima cita</h2>' +
    (next ? eventItem(next, true) : '<p class="muted">Aún no hay citas programadas.</p>') + '</section></div>' +
    '<div class="workspace-grid"><section class="card glass-panel"><h2>Objetivo</h2><p class="record">' +
    esc(client.goal || 'Pendiente de definir') + '</p><h3>Último peso registrado</h3><p>' +
    (latest ? number(latest.weight) + ' kg' : 'Sin mediciones') + '</p>' + btn('Ver evolución', 'view', '', '2') +
    '</section><section class="card glass-panel"><h2>Notas privadas</h2><p class="record">' +
    esc(client.coachNotes || 'Añade observaciones desde Editar ficha.') + '</p></section></div>' +
    (signedIn ? '<section class="card glass-panel"><div class="card-head"><h2>Acceso con Google</h2><span class="badge ' +
      (client.accessEnabled ? 'green">Habilitado' : 'gray">Sin acceso') + '</span></div><p>' + esc(client.email) +
      '</p><div class="actions">' + btn(client.accessEnabled ? 'Compartir invitación' : 'Habilitar acceso e invitar', 'invite-client', 'primary') +
      (client.accessEnabled ? btn('Revocar acceso', 'revoke-access') : '') + '</div></section>' : '');
}

export function appointmentStatus(entry) {
  return entry.cancelled ? 'Cancelada' : entry.completed ? 'Realizada' : eventTypes[entry.type];
}
