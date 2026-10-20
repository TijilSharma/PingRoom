import mongoose from 'mongoose';
const { Schema, model } = mongoose;
// Define an ObjectId field that Mongoose can populate from another collection.
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model });
const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      minlength: 2,
      maxlength: 30,
    },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String, default: '' },
    status: { type: String, enum: ['online', 'offline'], default: 'offline' },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true },
    title: { type: String, maxlength: 80 },
    ownerId: ref('User'),
    participants: [ref('User')],
    directKey: String,
    lastMessage: { text: String, senderId: ref('User'), sentAt: Date },
  },
  { timestamps: true },
);
conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { type: 'direct' } },
);
const messageSchema = new Schema(
  {
    conversationId: { ...ref('Conversation'), required: true },
    senderId: { ...ref('User'), required: true },
    text: { type: String, maxlength: 4000, default: '' },
    attachment: {
      url: String,
      type: { type: String, enum: ['image', 'file'] },
      fileName: String,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    deliveredTo: [ref('User')],
    readBy: [ref('User')],
    editedAt: Date,
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ text: 'text' });
export const User = model('User', userSchema);
export const Conversation = model('Conversation', conversationSchema);
export const Message = model('Message', messageSchema);
// Connect to MongoDB and wait for model indexes before the API starts.
export async function connect(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([User.init(), Conversation.init(), Message.init()]);
}
