import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { prepareScheduleDeletion, scheduleDeletePort } from '../src/client/compat/schedule-delete-port.ts';

const task = { id: 'task-a', sessionId: 'session-a', title: '每日喝水提醒' };
function fixture() {
  const requests: unknown[] = [];
  let records = [task, { ...task, id: 'task-b', sessionId: 'session-b' }];
  let outcome = { ok: true, value: { id: task.id, deleted: true } };
  const ctx = { get: () => ({ schedule: {
    catalog: async () => ({ ok: true, value: records }),
    delete: async (request: unknown) => { requests.push(request); return outcome; },
  } }) } as unknown as Context;
  return { port: scheduleDeletePort(ctx), requests,
    setRecords(value: typeof records) { records = value; },
    fail() { outcome = { ok: false, value: { id: task.id, deleted: false } }; },
    succeed() { outcome = { ok: true, value: { id: task.id, deleted: true } }; },
  };
}

test('opening confirmation only reads; explicit confirmation deletes the correct ID and session despite duplicate titles', async () => {
  const f = fixture();
  const operation = await prepareScheduleDeletion(f.port, 'detail-metadata-task-a');
  assert.deepEqual(f.requests, []);
  assert.deepEqual(operation.task, task);
  await operation.confirm();
  assert.deepEqual(f.requests, [{ id: 'task-a', sessionId: 'session-a' }]);
});

test('canceling after preparation leaves the task untouched', async () => {
  const f = fixture();
  await prepareScheduleDeletion(f.port, 'detail-metadata-task-a');
  assert.deepEqual(f.requests, []);
});

test('missing or ambiguous task identities never enable deletion', async () => {
  const f = fixture();
  await assert.rejects(prepareScheduleDeletion(f.port, 'detail-metadata-missing'), /不可用/);
  f.setRecords([task, { ...task, sessionId: 'other-session' }]);
  await assert.rejects(prepareScheduleDeletion(f.port, 'detail-metadata-task-a'), /不可用/);
  assert.deepEqual(f.requests, []);
});

test('double confirmation and confirmations after success do not repeat the mutation', async () => {
  const f = fixture();
  const operation = await prepareScheduleDeletion(f.port, 'detail-metadata-task-a');
  await Promise.all([operation.confirm(), operation.confirm()]);
  await operation.confirm();
  assert.equal(f.requests.length, 1);
});

test('failed deletion reports failure and permits explicit retry', async () => {
  const f = fixture();
  const operation = await prepareScheduleDeletion(f.port, 'detail-metadata-task-a');
  f.fail();
  await assert.rejects(operation.confirm(), /无法确认/);
  f.succeed();
  await operation.confirm();
  assert.equal(f.requests.length, 2);
});
