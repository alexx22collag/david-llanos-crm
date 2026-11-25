import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveWeek, approveWeek, migrateTraining, previousExercise, returnWeek, seed, submitWeek, updateExercise } from '../dist/model.js';

test('archivar conserva los registros y abre la próxima semana con la misma rutina', () => {
  const [client, other] = seed().clients;
  const first = client.week.exercises[0];
  Object.assign(first.sets[0], { weight:'62.5', reps:'10', rpe:'9.5', rir:'0', done:true });
  Object.assign(first.sets[1], { weight:'60', reps:'9', done:true });
  first.comment = 'Buena técnica';
  const weekNumber = client.week.number;
  assert.throws(() => approveWeek(client, ''), /enviar/);
  assert.throws(() => archiveWeek(client), /Aprueba/);
  submitWeek(client);
  assert.throws(() => submitWeek(client), /enviado/);
  approveWeek(client, ' Mantén la carga ');
  archiveWeek(client);

  assert.equal(client.history[0].number, weekNumber);
  assert.equal(client.history[0].feedback, 'Mantén la carga');
  assert.deepEqual(client.history[0].exercises[0], first);
  assert.equal(client.week.number, weekNumber + 1);
  assert.equal(client.week.status, 'active');
  const next = client.week.exercises[0];
  assert.equal(next.name, first.name);
  assert.equal(next.sets.length, first.sets.length);
  assert.equal(next.target, first.target);
  assert.equal(next.targetReps, first.targetReps);
  assert.equal(next.comment, '');
  assert.deepEqual(next.sets[0], { weight:'', reps:'', rpe:'', rir:'', done:false });
  assert.deepEqual(previousExercise(client.history, next), { exercise: first, week: weekNumber });
  assert.notEqual(next.id, first.id);
  assert.equal(other.history.length, 0);
});

test('la migración conserva los registros antiguos sin asignar sus pesos a series concretas', () => {
  const data = seed();
  const [client] = data.clients;
  const old = {id:'legacy', name:'Sentadilla', day:'Día 1', sets:'4 × 8–10', rest:'2 min', target:60, weight:'62.5', reps:'10 / 9', done:true, comment:'Semana anterior'};
  client.week.exercises = [old];
  client.history = [{...client.week, exercises:[{...old, id:'old-id'}]}];
  migrateTraining(data);
  migrateTraining(data);
  const [exercise] = client.week.exercises;
  assert.equal(exercise.sets.length, 4);
  assert.equal(exercise.targetReps, '8–10');
  assert.equal(exercise.restSeconds, 120);
  assert.equal(exercise.comment, old.comment);
  assert.deepEqual(exercise.sets[0], { weight:'', reps:'', rpe:'', rir:'', done:false });
  assert.deepEqual(previousExercise(client.history, exercise).exercise.legacy, {weight:'62.5', reps:'10 / 9', done:true});
});

test('al modificar series conserva los registros y protege las filas que ya tienen datos', () => {
  const [exercise] = seed().clients[0].week.exercises;
  exercise.sets[2].rir = '0';
  const plan = { name: exercise.name, setCount: 5 };
  const edited = updateExercise(exercise, plan);
  assert.equal(edited.sets.length, 5);
  assert.equal(edited.sets[2].rir, '0');
  assert.throws(() => updateExercise(edited, {...plan, setCount:2}), /Hay registros/);
});

test('devolver una semana conserva el registro y permite reenviarla', () => {
  const client = seed().clients[1];
  const original = structuredClone(client.week.exercises);
  assert.throws(() => returnWeek(client, '  '), /Indica qué/);
  returnWeek(client, ' Revisa el RIR de la última serie. ');
  assert.equal(client.week.status, 'active');
  assert.equal(client.week.revisionNote, 'Revisa el RIR de la última serie.');
  assert.deepEqual(client.week.exercises, original);
  assert.throws(() => approveWeek(client, ''), /enviar/);
  submitWeek(client);
  approveWeek(client, 'Correcto');
  archiveWeek(client);
  assert.equal(client.week.revisionNote, undefined);
  assert.deepEqual(client.history[0].exercises, original);
});
