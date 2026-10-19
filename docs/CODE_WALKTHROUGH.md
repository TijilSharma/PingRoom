# PingRoom code walkthrough

Use function names and route strings to navigate. Line numbers change when code is formatted.

## Follow one message through the system

1. `send` in `client/src/main.jsx` prevents the default form submission, guards against double clicks, and POSTs the text/attachment with the current JWT.
2. `makeApp` in `server/app.js` has already installed Helmet, JSON parsing, rate limits and authentication. JWT verification identifies the user; it does not by itself grant access to a conversation.
3. `content.parse` validates text length and HTTP(S) attachment metadata. The client cannot choose the sender ID.
4. `mongoose.connection.transaction` starts a session. `member` finds a conversation containing this user, using the same session.
5. `Message.create` inserts the record. The sender starts in both `readBy` and `deliveredTo`.
6. `snapshot` selects the newest message using `createdAt` and `_id`, then writes the cached preview to the conversation inside the transaction.
7. After commit, `populate` resolves the sender's username and `emit` sends `message:new` to each participant's user room.
8. The recipient fetches persisted data and posts a delivered/read receipt. A visible chat can count as read; Database Studio cannot.

A Socket.IO event is not the database write. If publication is interrupted after commit, the message remains durable and appears on history refresh. Exactly-once delivery is not promised.

## server/models.js

- `ref(model)`: reusable ObjectId reference declaration. A reference is not an enforced foreign key. Routes and transactions maintain application-level relationships.
- `userSchema`: identity fields and timestamps. `select: false` hides passwordHash by default. Login deliberately selects it for bcrypt comparison.
- `conversationSchema`: bounded participant array and optional cached lastMessage. `directKey` sorts both participant IDs and joins them; its partial unique index applies only to direct conversations.
- `messageSchema`: each message references a conversation and sender. Separate storage avoids an ever-growing array inside a 16 MB BSON document.
- `connect`: connects with a bounded server-selection timeout and waits for index initialization.

## server/app.js

- `id`, `username`, `credentials`, `attachment`, `content`: Zod validators reject unexpected types and invalid values before database writes. Regex search escapes user input. React escapes rendered message text.
- `oid`: explicitly creates an ObjectId for aggregation/update pipelines, where automatic Mongoose casting cannot be assumed.
- `fail`: throws an Error with an HTTP status for the final error handler.
- `publicUser`: returns a safe account projection without the password hash.
- `makeApp(secret)`: builds the Express application, allowing tests to use the same routes without starting the production server.
- `sign`: creates a signed token with subject = user ID and a one-day expiry. A JWT is signed, not encrypted.
- `member(cid, uid, session)`: combines document lookup and authorization. A non-member receives 404, avoiding disclosure of conversation existence.
- `snapshot(conv, session)`: recomputes the preview after insert/edit/delete. Recomputing matters when the latest message is deleted.
- `emit`: sends an event to participant rooms. Rooms are assigned by the authenticated server, not by client-supplied user IDs.
- Conversation list: populates participant details, aggregates unread counts with `$match` and `$group`, then combines results.
- History: queries newest-first, requests one extra record to detect another page, reverses the visible page into chronological order, and encodes the next cursor.
- Receipts: `$setUnion` makes acknowledgements idempotent. `$setIsSubset` checks whether every participant is represented. Read cannot regress to delivered.
- Database Studio: `$facet` runs conversation/day/status summaries over membership-filtered input. `$lookup` resolves conversation titles. `explain('executionStats')` exposes actual planner evidence.
- Account deletion: verifies the password. Direct chats and owned groups are deleted with messages. Other groups lose the account's membership/messages/receipt references and receive a refreshed preview.

## Stable pagination example

Suppose three messages share timestamp T and have IDs 103, 102 and 101 in descending order. A cursor `(T, 102)` must return records with a timestamp less than T **or** the same timestamp and an ID less than 102. Filtering only on timestamp skips 101. The compound index is `{ conversationId: 1, createdAt: -1, _id: -1 }`. ObjectId acts as a deterministic tie-breaker, not a guarantee of precise cross-machine creation time.

## server/realtime.js

- `realtime(server, app, secret)`: attaches Socket.IO to the same HTTP server and exposes it to API routes.
- `io.use`: verifies the handshake JWT, checks the account still exists, and stores trusted identity and expiry on socket.data.
- `publishPresence`: updates status/lastSeen and informs users sharing a conversation.
- `sockets`: in-memory count per user. Closing one tab leaves the user online if another connection remains.
- Typing handler: validates the ID, throttles events and checks membership before broadcasting to peers. Typing is temporary UI state, not a stored user status.
- Disconnect: clears the expiry timer and marks the last connection offline. This presence design assumes one Node process.

## React state and effects

- `api`: adds JSON headers and the JWT, parses the response and handles expired authentication.
- `run`: catches asynchronous errors for the visible error banner.
- `loadConvs`: refreshes the sidebar and clears a conversation that no longer exists.
- `receipt`: submits only messages not already acknowledged by the current user.
- `loadMessages`: loads a page and uses a request sequence plus active-conversation check to ignore stale responses.
- Refs expose the latest active chat, query and view to socket callbacks without reconnecting the socket on every render.
- Socket effect: registers listeners, reconnect refresh, visibility handling and a typing expiry timer. Cleanup disconnects and removes timers/listeners.
- Dialog effect: traps Tab within the dialog, supports Escape and restores focus to the opener.
- `Auth`, `Attachment`, `Database`: separate components for sign-in/register, URL attachment metadata and database inspection.

## Questions worth rehearsing

**Why MongoDB?** Document shapes fit the app and support bounded embedding, reference-based history, indexes and aggregation. A relational database would also work; MongoDB is a design choice, not a claim that SQL cannot scale.

**Is this schemaless?** MongoDB permits flexible documents, but this application imposes Mongoose schemas and Zod request validation. New fields still require deliberate schema, API and UI changes.

**Why a transaction?** A message and its cached preview live in separate documents. A partial update would create inconsistent UI. Transactions make these changes atomic; the rollback test demonstrates it.

**Does a replica set mean high availability?** Not this one-member configuration. It enables transactions; multiple voting/data-bearing members and operational setup are needed for failover.

**What does IXSCAN prove?** That the examined query used an index. It does not prove every query is optimal or that the application meets a latency target.

**Why bcrypt and JWT?** Bcrypt stores an adaptive password hash. JWT identifies authenticated requests. Membership and ownership checks provide authorization.

**What is denormalization here?** `lastMessage` repeats a small message summary in the conversation for fast sidebar reads. Transactions pay the consistency cost on writes.

**What does “read” mean?** Every current participant is in readBy, including the sender. It records a visible client acknowledgement, not human comprehension.

**What is unfinished for production?** Multi-node availability, shared presence across servers, durable event delivery, load tests, password recovery, token revocation, file uploads and end-to-end encryption.
