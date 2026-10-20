import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, Conversation } from './models.js';
// Attach authenticated Socket.IO connections to the HTTP server.
export function realtime(server, app, secret) {
  const io = new Server(server, { maxHttpBufferSize: 32768 });
  app.set('io', io);
  const sockets = new Map();
  // Reject sockets without a valid JWT or an existing account.
  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth.token || '', secret);
      const user = await User.findById(payload.sub);
      if (!user) throw Error();
      socket.data.uid = String(user._id);
      socket.data.expires = payload.exp;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
  // Persist presence and tell users who share a conversation with this user.
  const publishPresence = async (uid, status) => {
    await User.updateOne({ _id: uid }, { status, lastSeen: new Date() });
    const convs = await Conversation.find({ participants: uid });
    const peers = new Set(convs.flatMap((c) => c.participants.map(String)));
    for (const peer of peers)
      io.to(`user:${peer}`).emit('presence', { userId: uid, status });
  };
  // Count tabs per account so one closed tab does not mark the user offline.
  io.on('connection', (socket) => {
    const uid = socket.data.uid;
    socket.join(`user:${uid}`);
    sockets.set(uid, (sockets.get(uid) || 0) + 1);
    publishPresence(uid, 'online').catch(console.error);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expires * 1000 - Date.now()),
    );
    let lastTyping = 0;
    // Forward throttled typing signals only to members of that conversation.
    socket.on('typing', async (payload) => {
      if (
        !payload ||
        typeof payload.conversationId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(payload.conversationId) ||
        Date.now() - lastTyping < 400
      )
        return;
      lastTyping = Date.now();
      try {
        const conv = await Conversation.findOne({
          _id: payload.conversationId,
          participants: uid,
        });
        if (conv)
          for (const peer of conv.participants)
            if (String(peer) !== uid)
              io.to(`user:${peer}`).emit('typing', {
                conversationId: String(conv._id),
                userId: uid,
              });
      } catch (e) {
        console.error(e);
      }
    });
    // Publish offline status when the account's final socket disconnects.
    socket.on('disconnect', () => {
      clearTimeout(timer);
      const count = (sockets.get(uid) || 1) - 1;
      if (count) sockets.set(uid, count);
      else {
        sockets.delete(uid);
        publishPresence(uid, 'offline').catch(console.error);
      }
    });
  });
  return io;
}
