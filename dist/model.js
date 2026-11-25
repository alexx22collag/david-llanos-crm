export const sections = ['Entrenamiento','Alimentación','Mi evolución','Mediciones','Revisión semanal','Guías y recursos'];
export const uid = () => globalThis.crypto.randomUUID();
export const maxSets = 30;
const blankSet = () => ({ weight: '', reps: '', rpe: '', rir: '', done: false });
const blankSets = count => Array.from({ length: count }, blankSet);
export const hasSetLog = set => set.done || [set.weight, set.reps, set.rpe, set.rir].some(value => value != null && value !== '');

export function updateExercise(exercise, plan) {
  const count = Number(plan.setCount);
  if (!Number.isInteger(count) || count < 1 || count > maxSets) {
    throw Error('Indica entre 1 y ' + maxSets + ' series.');
  }
  if (exercise.sets.slice(count).some(hasSetLog)) {
    throw Error('Hay registros en las series que quieres quitar. Ajusta el número de series al abrir la próxima semana.');
  }
  const sets = [...exercise.sets.slice(0, count), ...blankSets(Math.max(0, count - exercise.sets.length))];
  const changedExercise = exercise.name && exercise.name.toLowerCase() !== plan.name.toLowerCase();
  if (changedExercise && (exercise.sets.some(hasSetLog) || exercise.legacy || exercise.comment)) {
    throw Error('Este ejercicio ya tiene registros. Añade otro ejercicio o cambia el nombre en la próxima semana.');
  }
  const { setCount, ...details } = plan;
  return { ...exercise, ...details, planId: changedExercise ? uid() : exercise.planId, sets };
}

export function createExercise(plan) {
  const id = uid();
  return updateExercise({ id, planId: id, sets: [], comment: '' }, plan);
}

function migrateExercise(exercise) {
  if (Array.isArray(exercise.sets)) {
    return { ...exercise, sets: exercise.sets.map(set => ({ ...blankSet(), ...set })) };
  }
  const { sets, rest, weight, reps, done, ...details } = exercise;
  const prescription = /^(\d+)\s*[×x]\s*(.+)$/i.exec(sets);
  const count = Math.min(maxSets, Math.max(1, Number(prescription?.[1] || 1)));
  const pause = /^(\d+)\s*(s|seg(?:undos)?|m|min(?:utos)?)?$/i.exec(rest);
  const restSeconds = pause ? Number(pause[1]) * (/^m/i.test(pause[2] || '') ? 60 : 1) : 0;
  return {
    ...details,
    planId: exercise.id,
    sets: blankSets(count),
    targetReps: prescription?.[2] || sets,
    restSeconds: restSeconds <= 3600 ? restSeconds : 0,
    restNote: (!pause || restSeconds > 3600) ? rest : '',
    coachNote: '',
    ...(weight !== '' || reps || done ? { legacy: { weight, reps, done } } : {})
  };
}

export function migrateTraining(data) {
  data.agenda ??= [];
  data.resources ??= [
    { id: 'example-squat', type: 'video', title: 'Sentadilla: técnica y variantes', note: 'Demostración de CrossFit, en inglés.', link: 'https://www.crossfit.com/essentials/foundational-movement-squat-what-is-a-squat' },
    { id: 'example-deadlift', type: 'video', title: 'Peso muerto convencional', note: 'Demostración de CrossFit, en inglés.', link: 'https://www.crossfit.com/essentials/the-deadlift-crossfit-foundational-movement' },
    { id: 'example-nutrition', type: 'nutrition', title: 'Guía de alimentación saludable', note: 'Material general de la Agencia Española de Seguridad Alimentaria y Nutrición (AESAN).', link: 'https://www.aesan.gob.es/es/nutricion/recomendaciones-dieteticas' }
  ];
  for (const client of data.clients) {
    for (const week of [client.week, ...client.history]) {
      week.exercises = week.exercises.map(migrateExercise);
    }
  }
  return data;
}

export function previousExercise(history, exercise) {
  for (const week of history) {
    const match = week.exercises.find(e => e.planId === exercise.planId)
      || week.exercises.find(e => e.day === exercise.day && e.name === exercise.name);
    if (match && (match.sets.some(hasSetLog) || match.legacy)) return { exercise: match, week: week.number };
  }
}

export function freshWeek(number = 48, exercises = []) {
  return {
    number, status: 'active', feedback: '',
    wellbeing: { energy: 7, sleep: 7, adherence: 85, notes: '' }, exercises
  };
}

function demoWeek() {
  const lower = 'Día 1 · Tren inferior';
  const upper = 'Día 2 · Tren superior';
  const exercises = [
    [lower, 'Sentadilla con barra', 4, '8–10', 120, 60],
    [lower, 'Peso muerto rumano', 3, '10–12', 90, 45],
    [lower, 'Hip thrust', 4, '10', 90, 70],
    [upper, 'Press de banca', 4, '8–10', 120, 35],
    [upper, 'Remo con mancuerna', 3, '12', 60, 18]
  ].map(([day, name, setCount, targetReps, restSeconds, target]) =>
    createExercise({ day, name, setCount, targetReps, restSeconds, target, coachNote: '' })
  );
  return freshWeek(48, exercises);
}
export function seed() {
  const clients = [
    ['Lucía Martínez', 'lucia@example.com', 'Ganar fuerza y mejorar composición corporal'],
    ['Carlos Romero', 'carlos@example.com', 'Volver a entrenar con constancia'],
    ['Ana García', 'ana@example.com', 'Mejorar rendimiento y movilidad']
  ].map(([name, email, goal]) => ({
    id: uid(), name, email, goal, week: demoWeek(), history: [], measurements: [], nutrition: ''
  }));
  const [lucia, carlos, ana] = clients;
  lucia.measurements = [
    { date: '2026-11-11', weight: 64.8, waist: 73 },
    { date: '2026-11-18', weight: 64.3, waist: 72.5 },
    { date: '2026-11-25', weight: 64.1, waist: 72 }
  ];
  lucia.nutrition = 'Prioriza una fuente de proteína en cada comida, verduras variadas y una hidratación regular.';
  for (const [index, set] of carlos.week.exercises[0].sets.entries()) {
    Object.assign(set, { weight: '60', reps: String(10 - index), rpe: String(7 + index * 0.5), rir: String(3 - index), done: true });
  }
  carlos.week.wellbeing.notes = 'Completé la primera sesión. Me gustaría revisar la técnica antes de subir la carga.';
  submitWeek(carlos);
  ana.week = freshWeek();

  const agenda = [[lucia, 'call', 0, '17:30'], [carlos, 'review', 1, '10:00'], [ana, 'call', 2, '12:00']].map(
    ([client, type, offset, time]) => {
      const day = new Date();
      day.setDate(day.getDate() + offset);
      const date = [day.getFullYear(), day.getMonth() + 1, day.getDate()].map(value => String(value).padStart(2, '0')).join('-');
      return { id: uid(), clientId: client.id, date, time, type, duration: 30, reminder: 15, link: '', notes: '', example: true };
    }
  );
  return { version: 1, clients, agenda };
}
export function submitWeek(client) {
  if (client.week.status !== 'active') throw Error('Esta semana ya se ha enviado.');
  client.week.status = 'submitted';
  client.week.submittedAt = new Date().toISOString();
}
export function returnWeek(client, note) {
  if (client.week.status !== 'submitted') throw Error('Solo puedes devolver una semana enviada.');
  if (!note.trim()) throw Error('Indica qué debe corregir el cliente.');
  client.week.status = 'active';
  client.week.revisionNote = note.trim();
}
export function approveWeek(client,feedback){if(client.week.status!=='submitted')throw Error('El cliente debe enviar la revisión primero.');client.week.status='approved';client.week.feedback=feedback.trim();}
export function archiveWeek(client) {
  const previous = client.week;
  if (previous.status !== 'approved') throw Error('Aprueba la semana antes de archivarla.');
  client.history.unshift({ ...structuredClone(previous), archivedAt: new Date().toISOString() });
  const exercises = previous.exercises.map(({ legacy, ...exercise }) => ({
    ...exercise, id: uid(), sets: blankSets(exercise.sets.length), comment: ''
  }));
  client.week = freshWeek(previous.number + 1, exercises);
}
export function validateBackup(data){if(data?.version!==1||!Array.isArray(data.clients)||!data.clients.length)throw Error('Copia de seguridad no válida.');for(const c of data.clients){if(typeof c.id!=='string'||typeof c.name!=='string'||!Array.isArray(c.week?.exercises)||!Array.isArray(c.history)||!Array.isArray(c.measurements)||!c.week.wellbeing||!['active','submitted','approved'].includes(c.week.status))throw Error('Los datos de clientes están incompletos.');}return data;}
