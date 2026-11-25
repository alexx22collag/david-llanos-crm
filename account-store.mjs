import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { getAccess, normalizeEmail, randomToken, tokenHash } from './auth.mjs';

const blankData = { version: 1, clients: [], agenda: [], resources: [] };
const editableSetFields = { weight: [0, 999, 0], reps: [0, 999, 1], rpe: [1, 10, 0.5], rir: [0, 20, 1] };

export function clientProjection(client) {
  const { coachNotes, accessEnabled, googleSubject, ...visible } = client;
  return visible;
}

function validNumber(value, [min, max, step], optional = false) {
  if (optional && value === '') return true;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max && (!step || Number.isInteger(number / step));
}

export function clientChange(current, incoming, now = new Date()) {
  const { week: nextWeek, measurements, ...nextProfile } = incoming || {};
  const { week: priorWeek, measurements: previousMeasurements, ...profile } = clientProjection(current);
  const invalid = () => { throw Error('Solo puedes editar tus registros y mediciones.'); };
  if (!isDeepStrictEqual(profile, nextProfile) || !Array.isArray(measurements) ||
      measurements.length > 4_000 || new Set(measurements.map(item => item?.date)).size !== measurements.length) invalid();
  for (const item of measurements) {
    if (!item || Object.keys(item).sort().join(',') !== 'date,waist,weight' ||
        typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
        !Number.isFinite(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0, 10) !== item.date ||
        !validNumber(item.weight, [1, 999, 0]) || !validNumber(item.waist, [1, 400, 0], true)) invalid();
  }
  if (!nextWeek || typeof nextWeek !== 'object') invalid();
  if (priorWeek.status !== 'active') {
    if (!isDeepStrictEqual(nextWeek, priorWeek)) invalid();
    return { ...current, measurements };
  }
  const { status, exercises, wellbeing, submittedAt, ...weekMetadata } = nextWeek;
  const { status: priorStatus, exercises: priorExercises, wellbeing: priorWellbeing, submittedAt: priorSubmittedAt, ...priorMetadata } = priorWeek;
  if (!isDeepStrictEqual(weekMetadata, priorMetadata) || !['active', 'submitted'].includes(status) ||
      !Array.isArray(exercises) || exercises.length !== priorExercises.length) invalid();
  if (status === 'active' && (!isDeepStrictEqual(wellbeing, priorWellbeing) || submittedAt !== priorSubmittedAt)) invalid();
  if (status === 'submitted' && (!wellbeing || Object.keys(wellbeing).sort().join(',') !== 'adherence,energy,notes,sleep' ||
      !validNumber(wellbeing.energy, [1, 10, 1]) || !validNumber(wellbeing.sleep, [0, 24, 0.5]) ||
      !validNumber(wellbeing.adherence, [0, 100, 1]) || typeof wellbeing.notes !== 'string' || wellbeing.notes.length > 1500)) invalid();
  exercises.forEach((exercise, index) => {
    if (!exercise) invalid();
    const { comment, sets, ...details } = exercise;
    const { comment: previousComment, sets: previousSets, ...previousDetails } = priorExercises[index];
    if (!isDeepStrictEqual(details, previousDetails) || typeof comment !== 'string' || comment.length > 600 ||
        !Array.isArray(sets) || sets.length !== previousSets.length) invalid();
    for (const set of sets) {
      if (!set || Object.keys(set).sort().join(',') !== 'done,reps,rir,rpe,weight' || typeof set.done !== 'boolean' ||
          Object.entries(editableSetFields).some(([field, range]) => !validNumber(set[field], range, true))) invalid();
    }
  });
  const week = { ...priorWeek, status, exercises, wellbeing };
  if (status === 'submitted') week.submittedAt = now.toISOString();
  return { ...current, week, measurements };
}

export function accountStore(file, adminEmail) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL, revision INTEGER NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, email TEXT NOT NULL, subject TEXT NOT NULL, expires INTEGER NOT NULL, method TEXT NOT NULL DEFAULT \'google\');' +
    'CREATE TABLE IF NOT EXISTS flows (key TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS email_links (key TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, client_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);'
  );
  if (!db.prepare('PRAGMA table_info(sessions)').all().some(column => column.name === 'method')) {
    db.exec("ALTER TABLE sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'google'");
  }
  db.prepare('INSERT OR IGNORE INTO workspace VALUES (1, ?, 0)').run(JSON.stringify(blankData));
  const snapshot = () => {
    const { data, revision } = db.prepare('SELECT data, revision FROM workspace WHERE id=1').get();
    return { data: JSON.parse(data), revision };
  };
  function permitted(identity, clients) {
    const access = getAccess(identity.email, clients, adminEmail);
    if (identity.method === 'email') return access?.role === 'client' ? access : null;
    if (access?.role !== 'client') return access;
    const member = clients.find(item => item.id === access.clientId);
    return !member.googleSubject || member.googleSubject === identity.subject ? access : null;
  }
  function getSession(token) {
    if (!token) return null;
    const identity = db.prepare('SELECT email, subject, method FROM sessions WHERE key=? AND expires>?').get(tokenHash(token), Date.now());
    const current = snapshot();
    const access = identity && permitted(identity, current.data.clients);
    return access ? { ...current, access } : null;
  }
  function view(session) {
    const { data, access, revision } = session;
    const cleanCoach = ({ googleSubject, ...item }) => item;
    const filtered = access.role === 'coach' ? { ...data, clients: data.clients.map(cleanCoach) } :
      { ...data, clients: [clientProjection(data.clients.find(item => item.id === access.clientId))], agenda: [] };
    return { user: access, data: filtered, revision };
  }
  function issueSession(identity, age, method) {
    const token = randomToken();
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions (key,email,subject,expires,method) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash(token), identity.email, identity.subject, Date.now() + age * 1000, method);
    return token;
  }
  return {
    newFlow() {
      const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
      db.prepare('DELETE FROM flows WHERE expires<=?').run(Date.now());
      db.prepare('INSERT INTO flows VALUES (?, ?, ?, ?)').run(tokenHash(flow.state), flow.nonce, flow.verifier, Date.now() + 600_000);
      return flow;
    },
    takeFlow(state) {
      if (!state) return null;
      return db.prepare('DELETE FROM flows WHERE key=? AND expires>? RETURNING nonce, verifier').get(tokenHash(state), Date.now()) || null;
    },
    signIn(identity, age) {
      const current = snapshot();
      const access = permitted(identity, current.data.clients);
      if (!access) return null;
      if (access.role === 'client') {
        const member = current.data.clients.find(item => item.id === access.clientId);
        if (!member.googleSubject) {
          member.googleSubject = identity.subject;
          db.prepare('UPDATE workspace SET data=?, revision=revision+1 WHERE id=1').run(JSON.stringify(current.data));
        }
      }
      return issueSession(identity, age, 'google');
    },
    issueEmail(email) {
      const access = getAccess(email, snapshot().data.clients, adminEmail);
      if (access?.role !== 'client') return null;
      const now = Date.now();
      db.prepare('DELETE FROM email_links WHERE expires<=?').run(now);
      const previous = db.prepare('SELECT created FROM email_links WHERE email=?').get(access.email);
      if (previous && now - previous.created < 60_000) return null;
      const token = randomToken();
      db.prepare('INSERT OR REPLACE INTO email_links VALUES (?, ?, ?, ?, ?)')
        .run(tokenHash(token), access.email, access.clientId, now, now + 900_000);
      return token;
    },
    discardEmail(token) {
      db.prepare('DELETE FROM email_links WHERE key=?').run(tokenHash(token));
    },
    useEmail(token, age) {
      const link = db.prepare('DELETE FROM email_links WHERE key=? AND expires>? RETURNING email, client_id')
        .get(tokenHash(token), Date.now());
      if (!link) return null;
      const access = getAccess(link.email, snapshot().data.clients, adminEmail);
      if (access?.role !== 'client' || access.clientId !== link.client_id) return null;
      return issueSession({ email: access.email, subject: access.clientId }, age, 'email');
    },
    signOut(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE key=?').run(tokenHash(token));
    },
    read(token) {
      const session = getSession(token);
      return session ? view(session) : null;
    },
    write(token, incoming, expectedRevision) {
      const session = getSession(token);
      if (!session) return { status: 401 };
      if (session.revision !== expectedRevision) return { status: 409 };
      const { data, access } = session;
      let next;
      if (!incoming || incoming.version !== 1 || !Array.isArray(incoming.clients)) throw Error('Formato de datos no válido.');
      if (access.role === 'client') {
        if (incoming.clients.length !== 1 || !isDeepStrictEqual(incoming.resources, data.resources) ||
            !isDeepStrictEqual(incoming.agenda, [])) throw Error('Solo puedes editar tu ficha.');
        next = { ...data, clients: data.clients.map(item =>
          item.id === access.clientId ? clientChange(item, incoming.clients[0]) : item
        ) };
      } else {
        if (!Array.isArray(incoming.resources) || !Array.isArray(incoming.agenda)) throw Error('Formato de datos no válido.');
        const previous = new Map(data.clients.map(item => [item.id, item]));
        const emails = new Set();
        const ids = new Set();
        const clients = incoming.clients.map(({ googleSubject, ...item }) => {
          const email = normalizeEmail(item.email);
          if (!email || email === adminEmail || emails.has(email) || ids.has(item.id) ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof item.id !== 'string' ||
              typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.week?.exercises) ||
              !Array.isArray(item.history) || !Array.isArray(item.measurements)) throw Error('Hay una ficha con datos o correo no válidos.');
          emails.add(email);
          ids.add(item.id);
          const prior = previous.get(item.id);
          const bound = normalizeEmail(prior?.email) === email ? prior.googleSubject : undefined;
          return { ...item, email, accessEnabled: item.accessEnabled === true, ...(bound ? { googleSubject: bound } : {}) };
        });
        next = { version: 1, clients, agenda: incoming.agenda, resources: incoming.resources };
      }
      const result = db.prepare('UPDATE workspace SET data=?, revision=revision+1 WHERE id=1 AND revision=?')
        .run(JSON.stringify(next), expectedRevision);
      if (result.changes && access.role === 'coach') {
        const enabled = new Map(next.clients.filter(item => item.accessEnabled).map(item => [item.id, item.email]));
        for (const link of db.prepare('SELECT key, email, client_id FROM email_links').all()) {
          if (enabled.get(link.client_id) !== link.email) db.prepare('DELETE FROM email_links WHERE key=?').run(link.key);
        }
      }
      return result.changes ? { status: 200, ...view({ data: next, access, revision: expectedRevision + 1 }) } : { status: 409 };
    },
    close() { db.close(); }
  };
}
