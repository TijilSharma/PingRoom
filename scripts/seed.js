import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { connect, User, Conversation, Message } from '../server/models.js';
export async function seed() {
  if (
    (await User.countDocuments()) ||
    (await Conversation.countDocuments()) ||
    (await Message.countDocuments())
  ) {
    console.log(
      'Database already contains data; seed skipped (nothing deleted).',
    );
    return;
  }
  const names = [
    'tijil',
    'aria',
    'dev',
    'maya',
    'rohan',
    'isha',
    'alex',
    'neha',
    'sam',
    'liam',
    'zoya',
    'noah',
  ];
  const hash = await bcrypt.hash('PingRoom@123', 12);
  const lines = [
    'Hey team! Ready for the database review?',
    'I have finished the users collection and unique indexes.',
    'Nice! The conversation model looks good to me.',
    'Can we walk through the aggregation pipeline?',
    'Yes, it groups unread messages by conversation.',
    'I added pagination so history loads in small batches.',
    'The compound index handles newest messages first.',
    'Let’s test a group conversation with three people.',
    'The message preview updates in the same transaction.',
    'Perfect. That keeps the two collections consistent.',
    'I will bring the sample dataset to the lab.',
    'We have more than fifty records ready for the demo.',
    'Try editing a message and checking the preview.',
    'Read receipts are tracked separately for each person.',
    'See you at the lab tomorrow!',
    'Thanks everyone, this is coming together really well.',
  ];
  await mongoose.connection.transaction(async (session) => {
    const users = await User.insertMany(
      names.map((username) => ({
        username,
        email: `${username}@vitstudent.ac.in`,
        passwordHash: hash,
      })),
      { session },
    );
    for (let c = 0; c < 6; c++) {
      const group = c < 3;
      const participants = group
        ? [users[0]._id, ...users.slice(c * 3 + 1, c * 3 + 4).map((u) => u._id)]
        : [users[0]._id, users[c - 2]._id];
      const [conv] = await Conversation.create(
        [
          {
            type: group ? 'group' : 'direct',
            title: group
              ? ['Database lab', 'Weekend plans', 'Project ideas'][c]
              : undefined,
            ownerId: users[0]._id,
            participants,
            directKey: group
              ? undefined
              : participants.map(String).sort().join(':'),
          },
        ],
        { session },
      );
      const docs = [];
      for (let m = 0; m < 20; m++) {
        const senderId = participants[m % participants.length];
        const readBy = m < 16 ? participants : [senderId];
        docs.push({
          conversationId: conv._id,
          senderId,
          text: lines[(m + c * 2) % lines.length],
          status: m < 16 ? 'read' : 'sent',
          readBy,
          deliveredTo: readBy,
          createdAt: new Date(Date.now() - (120 - c * 12 - m) * 180_000),
        });
      }
      await Message.insertMany(docs, { session });
      const last = docs.at(-1);
      conv.lastMessage = {
        text: last.text,
        senderId: last.senderId,
        sentAt: last.createdAt,
      };
      await conv.save({ session });
    }
  });
  console.log(
    'Seeded 12 users + 6 conversations + 120 messages = 138 documents.',
  );
  console.log('Demo login: tijil@vitstudent.ac.in / PingRoom@123');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await connect(process.env.MONGODB_URI);
    await seed();
  } finally {
    await mongoose.disconnect();
  }
}
