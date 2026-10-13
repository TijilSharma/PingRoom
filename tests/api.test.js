import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { createServer } from 'node:http';
import { io as client } from 'socket.io-client';
import { connect, User, Conversation, Message } from '../server/models.js';
import { makeApp } from '../server/app.js';
import { realtime } from '../server/realtime.js';
import { seed } from '../scripts/seed.js';
let app, server, io, base, a, b, c, conv;
const secret = 'test-secret-is-long-enough-for-integration-tests';
const auth = (method, url, who = a) => request(app)[method](url).set('Authorization', `Bearer ${who.token}`);
before(async () => {
  const uri = new URL(process.env.MONGODB_URI); uri.pathname = `/pingroom_test_${Date.now()}`;
  await connect(uri.toString());
  app = makeApp(secret); server = createServer(app); io = realtime(server, app, secret);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await mongoose.connection.dropDatabase(); await new Promise(r => io.close(r)); await mongoose.disconnect(); });
test('seed creates 138 valid documents and is non-destructive when repeated', async () => {
  await seed(); await seed();
  assert.equal(await User.countDocuments(), 12); assert.equal(await Conversation.countDocuments(), 6); assert.equal(await Message.countDocuments(), 120);
  for (const m of await Message.find()) { assert.ok(await User.exists({ _id: m.senderId })); assert.ok(await Conversation.exists({ _id: m.conversationId })); }
});
test('auth hashes passwords, rejects duplicates and protects API', async () => {
  for (const name of ['tester_a', 'tester_b', 'tester_c']) {
    const r = await request(app).post('/api/auth/register').send({ username: name, email: `${name}@test.com`, password: 'Testing123!' }).expect(201);
    assert.equal(r.body.user.passwordHash, undefined); if (name === 'tester_a') a = r.body; else if (name === 'tester_b') b = r.body; else c = r.body;
  }
  assert.notEqual((await User.findById(a.user._id).select('+passwordHash')).passwordHash, 'Testing123!');
  await request(app).post('/api/auth/register').send({ username: 'tester_a', email: 'different@test.com', password: 'Testing123!' }).expect(409);
  await request(app).post('/api/auth/login').send({ email: 'tester_a@test.com', password: 'badpassword' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'tester_a@test.com', password: 'Testing123!' }).expect(200);
  await request(app).get('/api/conversations').expect(401);
  await auth('patch', '/api/me').send({ username: 'tester_renamed' }).expect(200);
  const users = await auth('get', '/api/users?q=tester_').expect(200); assert.equal(users.body.length, 2); assert.equal(users.body[0].email, undefined);
});
test('direct chats deduplicate; membership and IDs validated', async () => {
  const r = await auth('post', '/api/conversations').send({ type: 'direct', participants: [b.user._id] }).expect(201); conv = r.body;
  const duplicate = await auth('post', '/api/conversations', b).send({ type: 'direct', participants: [a.user._id] }).expect(201); assert.equal(duplicate.body._id, conv._id);
  await auth('post', '/api/conversations').send({ type: 'group', title: 'Invalid', participants: [b.user._id] }).expect(400);
  await auth('get', `/api/conversations/${conv._id}/messages`, c).expect(404);
  await auth('post', `/api/conversations/${conv._id}/messages`, c).send({ text: 'Intrusion' }).expect(404);
  await auth('get', '/api/conversations/not-an-id/messages').expect(400);
  await auth('get', '/api/users?q=[').expect(200);
});
test('message CRUD, permissions, transactions, search, unread and receipts', async () => {
  const first = (await auth('post', `/api/conversations/${conv._id}/messages`).send({ text: 'hello aggregation' }).expect(201)).body;
  const second = (await auth('post', `/api/conversations/${conv._id}/messages`).send({ text: 'newest preview' }).expect(201)).body;
  assert.equal((await Conversation.findById(conv._id)).lastMessage.text, 'newest preview');
  await auth('patch', `/api/messages/${second._id}`, b).send({ text: 'stolen' }).expect(403);
  await auth('delete', `/api/messages/${second._id}`, b).expect(403);
  await auth('patch', `/api/messages/${second._id}`).send({ text: 'edited preview' }).expect(200);
  assert.equal((await Conversation.findById(conv._id)).lastMessage.text, 'edited preview');
  const results = await auth('get', `/api/conversations/${conv._id}/messages?q=aggregation`).expect(200); assert.equal(results.body.messages.length, 1);
  const list = await auth('get', '/api/conversations', b).expect(200); assert.equal(list.body[0].unread, 2);
  await auth('post', `/api/conversations/${conv._id}/receipts`, b).send({ status: 'delivered', messageIds: [first._id, second._id] }).expect(200);
  assert.equal((await Message.findById(first._id)).status, 'delivered');
  await auth('post', `/api/conversations/${conv._id}/receipts`, b).send({ status: 'read', messageIds: [first._id] }).expect(200);
  assert.equal((await Message.findById(first._id)).status, 'read');
  await auth('delete', `/api/messages/${second._id}`).expect(200);
  assert.equal((await Conversation.findById(conv._id)).lastMessage.text, 'hello aggregation');
  await auth('post', `/api/conversations/${conv._id}/messages`).send({ text: '' }).expect(400);
  await auth('post', `/api/conversations/${conv._id}/messages`).send({ attachment: { url: 'javascript:alert(1)', type: 'file', fileName: 'bad' } }).expect(400);
  await auth('post', `/api/conversations/${conv._id}/messages`).send({ attachment: { url: 'https://example.com/schema.png', type: 'image', fileName: 'schema.png' } }).expect(201);
});
test('pagination is stable with tied timestamps, with no overlap or omissions', async () => {
  const createdAt = new Date();
  await Message.insertMany(Array.from({ length: 65 }, (_, i) => ({ conversationId: conv._id, senderId: a.user._id, text: `page ${i}`, createdAt })));
  let before = '', seen = new Set();
  do {
    const r = await auth('get', `/api/conversations/${conv._id}/messages?limit=13${before ? `&before=${before}` : ''}`).expect(200);
    for (const m of r.body.messages) { assert.ok(!seen.has(m._id)); seen.add(m._id); } before = r.body.nextCursor;
  } while (before);
  assert.equal(seen.size, await Message.countDocuments({ conversationId: conv._id }));
  await auth('get', `/api/conversations/${conv._id}/messages?before=garbage`).expect(400);
});
test('group receipts require all recipients; only creator can rename/delete', async () => {
  const group = (await auth('post', '/api/conversations').send({ type: 'group', title: 'Test group', participants: [b.user._id, c.user._id] }).expect(201)).body;
  await auth('patch', `/api/conversations/${group._id}`, b).send({ title: 'Wrong' }).expect(403);
  await auth('patch', `/api/conversations/${group._id}`).send({ title: 'Renamed' }).expect(200);
  const m = (await auth('post', `/api/conversations/${group._id}/messages`).send({ text: 'For both of you' }).expect(201)).body;
  for (const who of [b, c]) await auth('post', `/api/conversations/${group._id}/receipts`, who).send({ status: 'read', messageIds: [m._id] }).expect(200);
  assert.equal((await Message.findById(m._id)).status, 'read');
  await auth('delete', `/api/conversations/${group._id}`, b).expect(403);
  await auth('delete', `/api/conversations/${group._id}`).expect(200);
  assert.equal(await Message.countDocuments({ conversationId: group._id }), 0);
});
test('failed transactions roll back both collections', async () => {
  const previous = (await Conversation.findById(conv._id)).lastMessage.text;
  const count = await Message.countDocuments({ conversationId: conv._id });
  await assert.rejects(mongoose.connection.transaction(async session => {
    await Message.create([{ conversationId: conv._id, senderId: a.user._id, text: 'should roll back' }], { session });
    await Conversation.updateOne({ _id: conv._id }, { 'lastMessage.text': 'should roll back' }, { session });
    throw Error('Simulated failure');
  }), /Simulated failure/);
  assert.equal(await Message.countDocuments({ conversationId: conv._id }), count);
  assert.equal((await Conversation.findById(conv._id)).lastMessage.text, previous);
});
test('database studio uses indexes and scopes aggregations to membership', async () => {
  const r = await auth('get', '/api/database').expect(200);
  assert.equal(r.body.replicaSet, 'rs0'); assert.ok(JSON.stringify(r.body.queryPlan).includes('IXSCAN'));
  assert.equal(r.body.activity.byConversation.length, 1);
  assert.equal(r.body.activity.byConversation[0]._id, conv._id);
  assert.ok(r.body.indexes.users.some(i => i.unique && i.key.email));
});
test('WebSocket authentication, typing, live delivery and multi-tab presence', async () => {
  const once = (s, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(`Timed out: ${event}`)), 5000); s.once(event, data => { clearTimeout(timer); resolve(data); }); });
  const sa = client(base, { auth: { token: a.token }, autoConnect: false });
  const sb = client(base, { auth: { token: b.token }, autoConnect: false });
  const sc = client(base, { auth: { token: c.token }, autoConnect: false });
  const bad = client(base, { auth: { token: 'invalid' }, autoConnect: false, reconnection: false });
  try {
    const denied = once(bad, 'connect_error'); bad.connect(); await denied;
    const ready = [once(sa, 'connect'), once(sb, 'connect'), once(sc, 'connect')]; sa.connect(); sb.connect(); sc.connect(); await Promise.all(ready);
    const typing = once(sb, 'typing'); sa.emit('typing', { conversationId: conv._id }); assert.equal((await typing).userId, a.user._id);
    let outsiderReceived = false; sc.on('message:new', () => { outsiderReceived = true; });
    const message = once(sb, 'message:new'); await auth('post', `/api/conversations/${conv._id}/messages`).send({ text: 'live socket proof' }).expect(201);
    assert.equal((await message).text, 'live socket proof'); assert.equal(outsiderReceived, false);
    const sa2 = client(base, { auth: { token: a.token }, autoConnect: false }); const ready2 = once(sa2, 'connect'); sa2.connect(); await ready2; sa.disconnect();
    await new Promise(r => setTimeout(r, 100)); assert.equal((await User.findById(a.user._id)).status, 'online'); sa2.disconnect();
  } finally { sa.disconnect(); sb.disconnect(); sc.disconnect(); bad.disconnect(); }
});
test('account deletion verifies password and removes references transactionally', async () => {
  const d = (await request(app).post('/api/auth/register').send({ username: 'delete_me', email: 'delete@test.com', password: 'Testing123!' }).expect(201)).body;
  const group = (await auth('post', '/api/conversations').send({ type: 'group', title: 'Keep this group', participants: [b.user._id, d.user._id] }).expect(201)).body;
  await auth('post', `/api/conversations/${group._id}/messages`, d).send({ text: 'Remove with account' }).expect(201);
  await auth('delete', '/api/me', d).send({ password: 'incorrect' }).expect(403);
  await auth('delete', '/api/me', d).send({ password: 'Testing123!' }).expect(200);
  assert.equal(await User.exists({ _id: d.user._id }), null);
  assert.equal(await Message.countDocuments({ senderId: d.user._id }), 0);
  assert.ok(!(await Conversation.findById(group._id)).participants.map(String).includes(d.user._id));
  assert.equal((await Conversation.findById(group._id)).lastMessage?.text, undefined);
  await auth('get', '/api/me', d).expect(401);
});
