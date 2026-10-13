import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
if (!existsSync('.env')) writeFileSync('.env', `MONGODB_URI=mongodb://127.0.0.1:27018/pingroom?directConnection=true&replicaSet=rs0\nJWT_SECRET=${randomBytes(48).toString('hex')}\nPORT=3100\nHOST=127.0.0.1\n`, { mode: 0o600 });
for (const args of [['run','db:up'], ['run','seed'], ['run','build']]) execFileSync('npm', args, { stdio: 'inherit' });
console.log('Ready! Run npm start and open http://localhost:3100');
