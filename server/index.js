import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, User } from './models.js';
import { makeApp } from './app.js';
import { realtime } from './realtime.js';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw Error('Set JWT_SECRET to at least 32 characters in .env');
await connect(process.env.MONGODB_URI);
await User.updateMany({}, { status: 'offline' });
const app = makeApp(process.env.JWT_SECRET);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
const server = createServer(app); const io = realtime(server, app, process.env.JWT_SECRET);
server.listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1', () => console.log(`PingRoom: http://localhost:${process.env.PORT || 3000}`));
async function stop() { io.close(); server.close(); await User.updateMany({}, { status: 'offline' }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
