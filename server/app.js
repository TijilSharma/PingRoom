import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User, Conversation, Message } from './models.js';

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid document ID');
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{2,30}$/, 'Use 2–30 letters, numbers or underscores');
const credentials = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(72),
});
const attachment = z.object({
  url: z.url().refine((s) => /^https?:\/\//i.test(s), 'Use an HTTP(S) URL'),
  type: z.enum(['image', 'file']),
  fileName: z.string().trim().min(1).max(150),
});
const content = z
  .object({
    text: z.string().trim().max(4000).default(''),
    attachment: attachment.optional(),
  })
  .refine((v) => v.text || v.attachment, 'Write a message or attach a link');
const oid = (s) => new mongoose.Types.ObjectId(s);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const publicUser = (u) => ({
  _id: u._id,
  username: u.username,
  email: u.email,
  avatarUrl: u.avatarUrl,
  status: u.status,
  lastSeen: u.lastSeen,
});
export function makeApp(secret) {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 500 }));
  const sign = (u) =>
    jwt.sign({ sub: String(u._id) }, secret, { expiresIn: '1d' });
  app.get('/api/health', (req, res) =>
    res.json({ ok: mongoose.connection.readyState === 1 }),
  );
  app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 30 }));
  app.post('/api/auth/register', async (req, res) => {
    const v = credentials.extend({ username }).parse(req.body);
    const u = await User.create({
      username: v.username,
      email: v.email,
      passwordHash: await bcrypt.hash(v.password, 12),
    });
    res.status(201).json({ token: sign(u), user: publicUser(u) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const v = credentials.parse(req.body);
    const u = await User.findOne({ email: v.email }).select('+passwordHash');
    if (!u || !(await bcrypt.compare(v.password, u.passwordHash)))
      fail(401, 'Invalid email or password');
    res.json({ token: sign(u), user: publicUser(u) });
  });
  app.use('/api', async (req, res, next) => {
    try {
      const payload = jwt.verify(
        req.headers.authorization?.replace(/^Bearer /, '') || '',
        secret,
      );
      req.user = await User.findById(payload.sub);
    } catch {
      return res.status(401).json({ error: 'Please log in again' });
    }
    if (!req.user)
      return res.status(401).json({ error: 'Account no longer exists' });
    next();
  });
  const emit = (conv, event, data) => {
    for (const p of conv.participants)
      app.get('io')?.to(`user:${p}`).emit(event, data);
  };
  app.set('notify', emit);
  async function member(cid, uid, session) {
    id.parse(cid);
    const conv = await Conversation.findOne({
      _id: cid,
      participants: uid,
    }).session(session || null);
    if (!conv) fail(404, 'Conversation not found');
    return conv;
  }
  async function snapshot(conv, session) {
    const last = await Message.findOne({ conversationId: conv._id })
      .sort({ createdAt: -1, _id: -1 })
      .session(session);
    conv.lastMessage = last
      ? {
          text: last.text || `Attachment: ${last.attachment.fileName}`,
          senderId: last.senderId,
          sentAt: last.createdAt,
        }
      : undefined;
    await conv.save({ session });
  }
  app.get('/api/me', (req, res) => res.json(publicUser(req.user)));
  app.patch('/api/me', async (req, res) => {
    const v = z.object({ username }).parse(req.body);
    req.user.username = v.username;
    await req.user.save();
    res.json(publicUser(req.user));
  });
  app.delete('/api/me', async (req, res) => {
    const { password } = z
      .object({ password: z.string().min(1).max(72) })
      .parse(req.body);
    const account = await User.findById(req.user._id).select('+passwordHash');
    if (!(await bcrypt.compare(password, account.passwordHash)))
      fail(403, 'Password is incorrect');
    let affected = [];
    await mongoose.connection.transaction(async (session) => {
      affected = await Conversation.find({
        participants: req.user._id,
      }).session(session);
      for (const conv of affected) {
        if (conv.type === 'direct' || conv.ownerId.equals(req.user._id)) {
          await Message.deleteMany({ conversationId: conv._id }, { session });
          await Conversation.deleteOne({ _id: conv._id }, { session });
        } else {
          await Message.deleteMany(
            { conversationId: conv._id, senderId: req.user._id },
            { session },
          );
          await Message.updateMany(
            { conversationId: conv._id },
            { $pull: { readBy: req.user._id, deliveredTo: req.user._id } },
            { session },
          );
          conv.participants = conv.participants.filter(
            (p) => !p.equals(req.user._id),
          );
          await Message.updateMany(
            { conversationId: conv._id },
            [
              {
                $set: {
                  status: {
                    $cond: [
                      { $setIsSubset: [conv.participants, '$readBy'] },
                      'read',
                      {
                        $cond: [
                          { $setIsSubset: [conv.participants, '$deliveredTo'] },
                          'delivered',
                          'sent',
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            { session, updatePipeline: true },
          );
          await snapshot(conv, session);
        }
      }
      await User.deleteOne({ _id: req.user._id }, { session });
    });
    for (const conv of affected) emit(conv, 'conversations:changed', {});
    app.get('io')?.in(`user:${req.user._id}`).disconnectSockets(true);
    res.json({ deleted: true });
  });
  app.get('/api/users', async (req, res) => {
    const q = z
      .string()
      .max(60)
      .parse(req.query.q || '');
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    res.json(
      await User.find({
        _id: { $ne: req.user._id },
        username: { $regex: escaped, $options: 'i' },
      })
        .select('username avatarUrl status lastSeen')
        .limit(50),
    );
  });
  app.get('/api/conversations', async (req, res) => {
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .sort({ updatedAt: -1 })
      .populate('participants', 'username status avatarUrl lastSeen')
      .lean();
    const unread = await Message.aggregate([
      {
        $match: {
          conversationId: { $in: conversations.map((c) => c._id) },
          senderId: { $ne: req.user._id },
          readBy: { $ne: req.user._id },
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    res.json(
      conversations.map((c) => ({
        ...c,
        unread: unread.find((u) => String(u._id) === String(c._id))?.count || 0,
      })),
    );
  });
  app.post('/api/conversations', async (req, res) => {
    const v = z
      .object({
        type: z.enum(['direct', 'group']),
        title: z.string().trim().min(1).max(80).optional(),
        participants: z.array(id).min(1).max(49),
      })
      .parse(req.body);
    const participants = [
      ...new Set([String(req.user._id), ...v.participants]),
    ];
    if (v.type === 'direct' && participants.length !== 2)
      fail(400, 'Direct chats need exactly two people');
    if (v.type === 'group' && (!v.title || participants.length < 3))
      fail(400, 'Groups need a name and at least three people');
    if (
      (await User.countDocuments({ _id: { $in: participants } })) !==
      participants.length
    )
      fail(400, 'Unknown participant');
    const directKey =
      v.type === 'direct' ? [...participants].sort().join(':') : undefined;
    let conv;
    try {
      conv = directKey
        ? await Conversation.findOneAndUpdate(
            { type: 'direct', directKey },
            {
              $setOnInsert: {
                type: 'direct',
                directKey,
                participants,
                ownerId: req.user._id,
              },
            },
            { upsert: true, returnDocument: 'after' },
          )
        : await Conversation.create({
            type: 'group',
            title: v.title,
            participants,
            ownerId: req.user._id,
          });
    } catch (e) {
      if (e.code !== 11000 || !directKey) throw e;
      conv = await Conversation.findOne({ directKey });
    }
    emit(conv, 'conversations:changed', {});
    res.status(201).json(conv);
  });
  app.patch('/api/conversations/:cid', async (req, res) => {
    const v = z
      .object({ title: z.string().trim().min(1).max(80) })
      .parse(req.body);
    const conv = await member(req.params.cid, req.user._id);
    if (conv.type !== 'group' || !conv.ownerId.equals(req.user._id))
      fail(403, 'Only the group creator can rename this group');
    conv.title = v.title;
    await conv.save();
    emit(conv, 'conversations:changed', {});
    res.json(conv);
  });
  app.delete('/api/conversations/:cid', async (req, res) => {
    let conv;
    await mongoose.connection.transaction(async (session) => {
      conv = await member(req.params.cid, req.user._id, session);
      if (!conv.ownerId.equals(req.user._id))
        fail(403, 'Only the creator can delete a conversation');
      await Message.deleteMany({ conversationId: conv._id }, { session });
      await Conversation.deleteOne({ _id: conv._id }, { session });
    });
    emit(conv, 'conversations:changed', {});
    res.json({ deleted: true });
  });
  app.get('/api/conversations/:cid/messages', async (req, res) => {
    await member(req.params.cid, req.user._id);
    const v = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        before: z.string().optional(),
        q: z.string().trim().max(100).optional(),
      })
      .parse(req.query);
    const filter = { conversationId: req.params.cid };
    if (v.before) {
      let cursor;
      try {
        cursor = JSON.parse(Buffer.from(v.before, 'base64url').toString());
      } catch {
        fail(400, 'Invalid cursor');
      }
      const c = z.object({ id, at: z.iso.datetime() }).parse(cursor);
      filter.$or = [
        { createdAt: { $lt: new Date(c.at) } },
        { createdAt: new Date(c.at), _id: { $lt: oid(c.id) } },
      ];
    }
    if (v.q) filter.$text = { $search: v.q };
    const rows = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(v.limit + 1)
      .populate('senderId', 'username')
      .lean();
    const more = rows.length > v.limit;
    if (more) rows.pop();
    const last = rows.at(-1);
    res.json({
      messages: rows.reverse(),
      nextCursor: more
        ? Buffer.from(
            JSON.stringify({ id: last._id, at: last.createdAt }),
          ).toString('base64url')
        : null,
    });
  });
  app.post('/api/conversations/:cid/messages', async (req, res) => {
    const v = content.parse(req.body);
    let message, conv;
    await mongoose.connection.transaction(async (session) => {
      conv = await member(req.params.cid, req.user._id, session);
      [message] = await Message.create(
        [
          {
            ...v,
            conversationId: conv._id,
            senderId: req.user._id,
            readBy: [req.user._id],
            deliveredTo: [req.user._id],
          },
        ],
        { session },
      );
      await snapshot(conv, session);
    });
    await message.populate('senderId', 'username');
    emit(conv, 'message:new', message);
    res.status(201).json(message);
  });
  app.patch('/api/messages/:mid', async (req, res) => {
    id.parse(req.params.mid);
    const v = content.parse(req.body);
    let message, conv;
    await mongoose.connection.transaction(async (session) => {
      message = await Message.findById(req.params.mid).session(session);
      if (!message) fail(404, 'Message not found');
      conv = await member(
        String(message.conversationId),
        req.user._id,
        session,
      );
      if (!message.senderId.equals(req.user._id))
        fail(403, 'You can only edit your own messages');
      message.text = v.text;
      message.attachment = v.attachment;
      message.editedAt = new Date();
      await message.save({ session });
      await snapshot(conv, session);
    });
    await message.populate('senderId', 'username');
    emit(conv, 'message:changed', message);
    res.json(message);
  });
  app.delete('/api/messages/:mid', async (req, res) => {
    id.parse(req.params.mid);
    let conv;
    await mongoose.connection.transaction(async (session) => {
      const message = await Message.findById(req.params.mid).session(session);
      if (!message) fail(404, 'Message not found');
      conv = await member(
        String(message.conversationId),
        req.user._id,
        session,
      );
      if (!message.senderId.equals(req.user._id))
        fail(403, 'You can only delete your own messages');
      await message.deleteOne({ session });
      await snapshot(conv, session);
    });
    emit(conv, 'message:deleted', {
      _id: req.params.mid,
      conversationId: conv._id,
    });
    res.json({ deleted: true });
  });
  app.post('/api/conversations/:cid/receipts', async (req, res) => {
    const { status, messageIds } = z
      .object({
        status: z.enum(['delivered', 'read']),
        messageIds: z.array(id).min(1).max(100),
      })
      .parse(req.body);
    const conv = await member(req.params.cid, req.user._id);
    const sets = {
      deliveredTo: { $setUnion: ['$deliveredTo', [req.user._id]] },
    };
    if (status === 'read')
      sets.readBy = { $setUnion: ['$readBy', [req.user._id]] };
    await Message.updateMany(
      {
        conversationId: conv._id,
        _id: { $in: messageIds.map(oid) },
        senderId: { $ne: req.user._id },
      },
      [
        { $set: sets },
        {
          $set: {
            status: {
              $cond: [
                { $setIsSubset: [conv.participants, '$readBy'] },
                'read',
                {
                  $cond: [
                    { $setIsSubset: [conv.participants, '$deliveredTo'] },
                    'delivered',
                    'sent',
                  ],
                },
              ],
            },
          },
        },
      ],
      { updatePipeline: true },
    );
    emit(conv, 'receipts:changed', { conversationId: conv._id });
    res.json({ ok: true });
  });
  app.get('/api/database', async (req, res) => {
    const convs = await Conversation.find({
      participants: req.user._id,
    }).select('_id');
    const ids = convs.map((c) => c._id);
    const activity = await Message.aggregate([
      { $match: { conversationId: { $in: ids } } },
      {
        $facet: {
          byConversation: [
            {
              $group: {
                _id: '$conversationId',
                messages: { $sum: 1 },
                characters: { $sum: { $strLenCP: '$text' } },
              },
            },
            {
              $lookup: {
                from: 'conversations',
                localField: '_id',
                foreignField: '_id',
                as: 'conversation',
              },
            },
            {
              $project: {
                messages: 1,
                characters: 1,
                title: { $arrayElemAt: ['$conversation.title', 0] },
              },
            },
            { $sort: { messages: -1 } },
          ],
          byDay: [
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                messages: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          statuses: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        },
      },
    ]);
    const indexes = {};
    for (const m of [User, Conversation, Message])
      indexes[m.collection.name] = await m.collection.indexes();
    const explain = ids.length
      ? await Message.find({ conversationId: ids[0] })
          .sort({ createdAt: -1, _id: -1 })
          .limit(30)
          .explain('executionStats')
      : null;
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    res.json({
      counts: {
        users: await User.countDocuments(),
        conversations: await Conversation.countDocuments(),
        messages: await Message.countDocuments(),
      },
      scope:
        'Activity is limited to your conversations. Collection counts are global.',
      activity: activity[0],
      indexes,
      replicaSet: hello.setName || null,
      queryPlan: explain?.queryPlanner.winningPlan,
      executionStats: explain
        ? {
            returned: explain.executionStats.nReturned,
            keysExamined: explain.executionStats.totalKeysExamined,
            documentsExamined: explain.executionStats.totalDocsExamined,
          }
        : null,
    });
  });
  app.use('/api', (req, res) =>
    res.status(404).json({ error: 'Endpoint not found' }),
  );
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((e) => e.message).join('; ') });
    if (err.code === 11000)
      return res
        .status(409)
        .json({ error: 'Username or email already exists' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
