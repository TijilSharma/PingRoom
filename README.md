# PingRoom

PingRoom is a full-stack MERN chat application built for the Database Systems review brief. It uses MongoDB, Express, React, Node.js, Mongoose, and Socket.IO.

## Run locally

```bash
npm install
npm run setup
npm start
```

Open http://localhost:3100. The setup script starts a local MongoDB replica set in Docker, builds the React application, and loads the sample data once.

Demo login: `tijil@vitstudent.ac.in` / `PingRoom@123`.

## What is included

- `users`, `conversations`, and `messages` MongoDB collections with unique, compound, multikey, and text indexes.
- 12 users, 6 conversations, and 120 messages: 138 sample documents.
- Registration/login with bcrypt password hashes and JWT authentication.
- Direct and group conversations, real-time messages, typing and presence.
- Message edit/delete, attachment links, search, stable cursor pagination, and per-user delivery/read receipts.
- Multi-document MongoDB transactions for message writes, deletes, account deletion, and conversation cleanup.
- Database Studio in the UI with aggregation output, index metadata, query-plan inspection, and replica-set status.

## Verification

```bash
npm test
```

The test suite covers authentication, authorization, CRUD, transactions, pagination, aggregation scoping, index use, WebSocket delivery, typing, presence, and account deletion.

The formal Review 2 report and prototype slides are in `output/`. Screenshots captured from the running app are in `docs/screenshots/`.
