# PingRoom system design and code viva guide

This guide explains the current implementation, not an idealized chat application. Read it with the source open. The existing CODE_WALKTHROUGH.md is a shorter revision sheet. This guide adds database reasoning, worked examples and questions to answer aloud.

## 1. The system in one minute

PingRoom is a browser-based chat application. React displays conversations and keeps temporary UI state. Express runs the HTTP API inside Node.js. MongoDB stores users, conversations and messages. Mongoose supplies the models used to query MongoDB. Socket.IO maintains a connection for live notifications, typing and presence.

A message is sent through an authenticated HTTP POST. The API checks membership and writes the message and the conversation preview in a transaction. Only after commit does it publish a Socket.IO event. Other clients acknowledge delivery or reading and refresh their data.

There are three server processes to think about: Node, MongoDB and Redis. React executes in each browser. MongoDB stores chat data. Redis stores short-lived rate-limit counters. Docker runs the local MongoDB and Redis containers. The production Node server serves the built React files as well as the API. Vite is the frontend development/build tool.

**Say aloud:** “The message record is the persistent source of truth. Socket.IO is the notification channel. Losing a notification does not delete the stored message.”

## 2. Reading order and responsibilities

| File | Read it to understand |
| --- | --- |
| server/models.js | Collection shapes, reference fields and indexes |
| server/index.js | Startup order and HTTP/socket wiring |
| server/app.js | Validation, authentication, every HTTP operation and database behavior |
| server/realtime.js | Socket identity, rooms, typing and presence |
| client/src/main.jsx | React state, API helpers, event listeners and user actions |
| client/src/components/Auth.jsx | Register/login form submission |
| client/src/components/Attachment.jsx | Attachment link form |
| client/src/components/Database.jsx | Presentation of database results |
| scripts/seed.js | Sample data and transactional insertion |
| scripts/setup.js | Local environment, database startup, seed and build |
| compose.yaml | MongoDB replica-set container, persistent MongoDB volume and Redis container |
| vite.config.js | Build output and development proxy |
| tests/api.test.js | Database/API/socket assertions |
| tests/browser/chat.spec.js | Real browser interaction assertions |
| playwright.config.js | Browser test server and browser settings |
| .github/workflows/verify.yml | Fresh-machine verification commands |
| client/src/style.css | Layout, spacing, responsive behavior and visual states |

Do not spend equal time on every file. Database models and app.js deserve most of your preparation time.

## 3. Collections and relationships

### Users

`_id` is the document identifier. `username` and `email` are unique. `passwordHash` stores a bcrypt hash, never the plaintext password. `status` is online/offline and `lastSeen` records activity. `timestamps: true` makes Mongoose manage createdAt and updatedAt.

`select: false` on passwordHash excludes it from normal Mongoose queries. Login deliberately adds it back with `.select('+passwordHash')` so bcrypt can compare the supplied password. This projection does not encrypt the field or prevent someone with direct database access from reading it.

### Conversations

A conversation has `type`, optional group `title`, `ownerId`, `participants`, optional `directKey`, and a small `lastMessage` object.

`participants` is an embedded array of user ObjectIds. The user documents themselves are referenced, not embedded. `ownerId` controls rename/deletion permissions; it is not the sender of every message.

`lastMessage` stores text, senderId and sentAt. It is a cached preview, not the complete history.

### Messages

A message references its `conversationId` and `senderId`. It has text and/or attachment metadata, status, deliveredTo, readBy, editedAt and timestamps. There is one message document per message.

An attachment is `{url, type, fileName}`. The application stores an external link; it does not upload or store the binary file. An image-type attachment is still rendered as a link in the current chat UI.

### Cardinality

- User to conversation: many-to-many, represented by participants.
- Conversation to message: one-to-many.
- User to authored message: one-to-many.
- User to owned conversation: one-to-many under the current owner model.

A relational version could use Users, Conversations, ConversationParticipants, Messages and MessageReceipts tables. PingRoom embeds bounded participant/receipt arrays instead of separate junction tables.

### Why separate messages?

Conversation history can grow indefinitely. An embedded history array would grow the parent document and eventually hit MongoDB's 16 MiB BSON document limit. Independent message documents support indexed pagination and keep each conversation document small.

### Why reference users?

The same user appears in many conversations. Copying the full profile into each conversation would require many updates after a username change. Keeping one user document avoids that update anomaly.

### Is this normalized?

The design uses references to avoid copying shared users, but deliberately denormalizes lastMessage. Do not claim that the entire document model is “in 3NF.” Relational normal forms describe relations and dependencies; here you should explain the actual redundancy and its cost.

### Are refs foreign keys?

No. `ref: 'User'` tells Mongoose which model to use for population. It does not force the referenced user to exist in MongoDB. The API verifies participant existence and handles cleanup. Raw database writes can bypass these application rules.

## 4. Startup and configuration

`server/index.js`:

1. Loads `.env` through dotenv.
2. Rejects a missing/short JWT secret.
3. Connects to Redis before accepting requests; rate limits require it.
4. Calls `connect(MONGODB_URI)` and waits for models/index initialization.
5. Resets stored presence to offline, since connections from an earlier process no longer exist.
6. Calls `makeApp(secret, redis)` to construct Express.
7. Serves the frontend build from dist and returns index.html for frontend paths.
8. Creates an HTTP server around Express.
9. Attaches Socket.IO to that same HTTP server.
10. Listens on the configured host and port, normally 127.0.0.1:3100.

`connect(uri)` waits for mongoose.connect, with a 10-second server-selection timeout, then waits for User.init, Conversation.init and Message.init. Initializing indexes matters because unique constraints need the indexes to exist.

`stop()` closes Socket.IO and the server, resets presence and exits on SIGINT/SIGTERM. It is a basic local shutdown handler, not a full production request-draining design.

`scripts/setup.js` generates a random secret only if .env is absent, then runs database startup, seed and build sequentially. A failure stops setup. The environment file has restrictive permissions and is gitignored.

Docker exposes MongoDB at host port 27018 and Redis at host port 6380. The named MongoDB volume keeps chat data across container restarts. The MongoDB healthcheck initializes rs0 if necessary. One replica-set member enables transactions but gives no failover. Redis counters expire after one minute.

## 5. How to explain any function

Use this five-part answer:

1. **Purpose:** What problem does it solve?
2. **Inputs:** Which parameters, body fields, user identity or state does it use?
3. **Checks:** What can reject the operation?
4. **Work:** What database reads/writes or UI changes happen?
5. **Result:** What returns or gets emitted, and what happens on failure?

For example, `member(cid, uid, session)` receives a conversation ID, current user ID and optional transaction session. It validates the ID and finds a conversation where both `_id` and membership match. It returns the conversation document, or throws 404. When a session is supplied, the query participates in that transaction.

## 6. Shared API functions and middleware

| Symbol | Exact responsibility |
| --- | --- |
| id | Zod validator for a 24-character hexadecimal ID string |
| username | Trims, lowercases and validates a 2–30 character handle |
| credentials | Validates email and password shape/length |
| attachment | Requires HTTP(S), valid type and a bounded filename |
| content | Accepts bounded text and optional attachment; rejects an empty message with neither |
| oid(s) | Constructs a Mongoose ObjectId from a string |
| fail(status, message) | Throws an Error with an HTTP status property |
| publicUser(u) | Builds the returned account object without passwordHash |
| makeApp(secret, redis, rateLimitPrefix?) | Constructs middleware, Redis-backed limits, routes and error handlers; returns Express without listening |
| limiter(limit, prefix) | Gives API and auth limits separate Redis counters and one-minute windows |
| sign(u) | Signs a JWT with subject=user ID and one-day expiry |
| emit(conv, event, data) | Publishes to the authenticated user rooms of conversation participants |
| member(cid, uid, session) | Combines lookup and membership authorization |
| snapshot(conv, session) | Finds the latest message and saves its preview on the conversation |

Middleware runs in registration order. Helmet sets security headers. express.json parses bounded JSON bodies. Redis holds rate-limit counters: 500 requests per minute across `/api` and 30 per minute across `/api/auth`. Both limits apply to auth requests. Public auth routes appear before the middleware that requires a JWT. Protected routes appear after it. The final error middleware has four parameters so Express recognizes it as an error handler.

JWT authentication verifies the signature/expiry and fetches the account. Membership/ownership checks are separate authorization. A valid token does not grant access to every conversation.

`makeApp` is separate from startup so tests can construct an API without starting the production server.

## 7. Every route

| Operation | Work and checks | Database concept |
| --- | --- | --- |
| GET /api/health | Returns whether Mongoose is connected | Connection state; not a complete infrastructure health check |
| POST /api/auth/register | Validate, hash password at cost 12, insert user, return token and safe profile | Insert, unique index |
| POST /api/auth/login | Find by email including hash, bcrypt compare, issue JWT | Indexed lookup, projection |
| GET /api/me | Return authenticated profile | Identity projection |
| PATCH /api/me | Validate username and save current user | Update, unique constraint |
| DELETE /api/me | Verify password, clean related data and delete account transactionally | Application-managed referential integrity |
| GET /api/users | Escaped case-insensitive username search, exclude self, select safe fields, limit 50 | Filter, projection, limit |
| GET /api/conversations | Filter by membership, sort, populate users, aggregate unread counts | Multikey query, aggregation |
| POST /api/conversations | Deduplicate IDs, include creator, validate people/count/title, create or reuse direct chat | Upsert, partial unique index |
| PATCH /api/conversations/:cid | Require membership, group type and owner; save title | Authorization and single-document update |
| DELETE /api/conversations/:cid | Require creator, delete messages and conversation in a transaction | Cascading cleanup |
| GET /api/conversations/:cid/messages | Require membership, validate cursor/search/limit, query and return a page | Range pagination and indexes |
| POST /api/conversations/:cid/messages | Validate, authorize, insert message and refresh preview transactionally, emit after commit | Multi-document atomicity |
| PATCH /api/messages/:mid | Find message, check membership and sender, replace content and update preview | Transaction and ownership |
| DELETE /api/messages/:mid | Check membership/sender, delete and recalculate preview | Transaction and derived data |
| POST /api/conversations/:cid/receipts | Check membership, scope IDs to conversation, union receipts, calculate status | Atomic update pipeline per message |
| GET /api/database | Scoped activity, global counts, indexes, explain and replica-set metadata | Aggregation and query planning |

An API call to an unknown route returns 404. Invalid Zod input returns 400. Missing authentication returns 401. Ownership failures return 403. Duplicate identity indexes return error 11000, mapped to 409. Unexpected server errors return a generic 500 message.

## 8. A message from click to database to recipient

Imagine Tijil sends “Review at 10” in a group containing Tijil, Riya and Vidhanshu. These names illustrate the flow; they are not the seed account list.

1. `send(e)` stops native form submission. It rejects an empty draft or a second click while busy.
2. `api()` sends JSON to POST /api/conversations/:cid/messages with the JWT in Authorization.
3. Authentication sets req.user. The request cannot choose senderId.
4. `content.parse(req.body)` validates the message.
5. `mongoose.connection.transaction(async session => ...)` starts the multi-document operation.
6. `member` checks that Tijil belongs to this conversation.
7. Message.create inserts text, conversationId, senderId and initial receipt arrays containing Tijil.
8. `snapshot` selects the newest message and saves the conversation's lastMessage.
9. The transaction commits. Only now does the handler populate sender details and emit message:new.
10. Each participant's connected sockets receive the event. The HTTP response separately confirms creation to the sender.
11. A recipient's browser posts delivered or read depending on whether the relevant chat is visible.
12. The server updates receipts and emits receipts:changed. Clients reload the relevant state.

**Why not emit inside the transaction?** It could announce a message that later rolls back. Retrying a transaction callback could also repeat an external side effect.

**What if commit succeeds and the server crashes before emit?** The stored message survives, but the live notification can be missed. History refresh recovers it. A transactional outbox would be a possible production improvement; PingRoom does not implement one.

**What if the HTTP response is lost and a client retries?** There is no idempotency key for message sends, so a retry could create another message. Do not claim exactly-once messaging.

## 9. snapshot in detail

```js
const last = await Message.findOne({ conversationId: conv._id })
  .sort({ createdAt: -1, _id: -1 })
  .session(session);
```

Find one message in the conversation, selecting the newest under the deterministic sort. `-1` means descending. The same session lets the query see the transaction's own writes.

The function copies text, senderId and createdAt into lastMessage. For an attachment-only message, it uses an attachment filename preview. If no messages remain, it clears the preview. `conv.save({session})` persists the change and updates the conversation timestamp.

If the latest message is deleted, the previous one becomes the preview. If an older message is edited, the newest message remains the preview. Recomputing handles both cases, although doing it for every edit adds work.

The sidebar sorts by conversation updatedAt, so a group rename or message edit can also move the conversation. It is not strictly sorted only by the last message's original sent time.

## 10. Transactions and ACID

- **Atomicity:** message insertion and preview update both commit or neither does.
- **Consistency:** application rules and database constraints preserve the intended valid state. A transaction does not invent rules such as “sender must be a member.”
- **Isolation:** transaction reads/writes follow MongoDB transaction semantics. Do not claim this code explicitly configures serializable isolation; it does not set a custom read concern here.
- **Durability:** committed data is stored persistently according to the database's write concern and storage configuration. The Docker volume persists files; it is not a backup or a redundant replica.

A normal update to a single MongoDB document is already atomic. A multi-document transaction is needed for invariants spanning documents, such as a message plus its conversation preview.

An updateMany outside a transaction is atomic per modified document, not all-or-nothing for the entire batch. Receipt updates use this behavior: each message's receipt arrays and status change together in an update pipeline. The whole batch is not wrapped in a transaction.

A session associates operations with the transaction. Omitting it from one operation can put that operation outside the transaction. A session is unrelated to sessionStorage or the user's JWT.

Official reference: https://www.mongodb.com/docs/manual/core/write-operations-atomicity/

## 11. Direct-chat uniqueness and concurrent requests

For user IDs A and B:

```js
[A, B].sort().join(':') === [B, A].sort().join(':')
```

That stable string is directKey. A Set removes repeated participant IDs first. The server also adds the current user automatically.

`findOneAndUpdate` uses `upsert: true`: match an existing direct conversation or insert one. `$setOnInsert` sets creation fields only when inserting, preserving the existing owner. `returnDocument: 'after'` returns the result after the operation.

A unique partial index on directKey applies only when type is direct. Group chats can omit directKey and are not constrained to one group per participant set.

Checking for an existing chat with findOne and then separately inserting is insufficient under concurrency: two requests can both see no record. The database unique index prevents both inserts from winning. Error 11000 is handled by fetching the existing direct chat.

`unique: true` is an index declaration, not a Mongoose validator. Official reference: https://mongoosejs.com/docs/validation

Groups need at least three members at creation. Account deletion can leave an existing group with fewer than three; the creation rule is not a perpetual minimum enforced in the schema.

## 12. Indexes and costs

An index is an additional data structure for locating records and, for suitable query shapes, providing an ordered scan. It costs disk/memory and extra maintenance on writes. Adding an index to every field would not be a good answer.

| Index | Why it exists |
| --- | --- |
| users._id | Default unique document identity |
| users.username, users.email | Two separate unique indexes |
| conversations.participants + updatedAt | Membership filtering and recent ordering |
| conversations.directKey | Partial unique constraint on direct chats |
| messages.conversationId + createdAt + _id | Filter one chat and traverse newest-first with a tie-breaker |
| messages.text | Token-based full-text search |

A compound index contains multiple fields in an ordered key. Field order matters: the message index groups by conversation first, then orders that conversation's messages. It is not interchangeable with one starting with createdAt for this access pattern.

An array-indexed field makes an index multikey. A conversation with three participant IDs contributes index entries associated with those values. The participants index is both compound and multikey. These are compatible descriptions, not competing categories. Verify a query plan instead of assuming every multikey query avoids a sort.

A text index does not mean arbitrary substring search. The message endpoint uses MongoDB `$text`; the user-search endpoint uses an escaped regex. An unanchored case-insensitive regex can be expensive even though username has a unique index.

Official reference: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/

### explain

- IXSCAN: scanned an index.
- COLLSCAN: scanned collection documents without that index access path.
- FETCH: retrieved full documents after locating them through an index.
- SORT: an explicit sorting stage.
- nReturned: number returned by this query.
- totalKeysExamined: index entries inspected.
- totalDocsExamined: documents inspected.

IXSCAN does not mean “optimal.” Examine how much work was done relative to the result, and whether the query includes a blocking sort. The test verifies an index scan for a selected history query. It does not prove every endpoint meets a latency target.

## 13. Pagination worked example

Suppose descending query order is:

| createdAt | Simplified ID |
| --- | --- |
| 10:01 | 205 |
| 10:00 | 204 |
| 10:00 | 203 |
| 09:59 | 202 |

A page size of two returns 205 and 204. The next cursor is `(10:00, 204)`.

The next filter is:

```js
createdAt < '10:00'
OR (createdAt === '10:00' AND _id < 204)
```

It returns 203 and 202. Filtering only `createdAt < 10:00` would skip 203. ObjectId gives a tie-breaker, not a universal exact chronology across machines.

The handler fetches limit+1. With a limit of 30, a 31st record tells us another page exists. It removes that extra record, creates the cursor from the last retained record, then reverses the retained rows for oldest-to-newest display within the page.

The base64url cursor encodes JSON; it does not encrypt it. The server validates it, and membership authorization still applies.

Offset pagination with skip can be costly for deep pages and can shift under new inserts. Cursor pagination continues relative to a known ordering key. This implementation does not promise a frozen database snapshot across separate page requests.

## 14. Aggregation worked example

For Riya, suppose chat C has four messages:

- M1 from Tijil; Riya is in readBy.
- M2 from Tijil; Riya is not in readBy.
- M3 from Riya; Riya is in readBy.
- M4 from Vidhanshu; Riya is not in readBy.

The unread pipeline first restricts conversationId to Riya's member conversations. It excludes Riya's own messages and messages with Riya in readBy. M2 and M4 remain. Grouping by conversationId with `$sum: 1` gives C an unread count of 2.

```js
{ $group: { _id: '$conversationId', count: { $sum: 1 } } }
```

Here `_id` is the output group's key, not the original message ID. `'$conversationId'` refers to a field. `'conversationId'` without `$` would be a literal string in that expression position.

| Operator | Meaning in PingRoom |
| --- | --- |
| $match | Retain messages matching membership or unread conditions |
| $group | Combine messages into conversation/day/status groups |
| $sum: 1 | Add one per input document |
| $strLenCP | Count Unicode code points in message text, not bytes |
| $lookup | Join grouped conversation IDs with conversation documents in MongoDB |
| $project | Choose/compute output fields |
| $arrayElemAt | Extract the first joined title from an array |
| $sort | Order summary rows |
| $facet | Run several sub-pipelines over the same input stream |
| $dateToString | Convert createdAt into a day grouping key |

The day pipeline does not specify a timezone, so do not describe its grouping as local India calendar dates without changing it.

`populate()` resolves references through Mongoose. `$lookup` joins within a MongoDB aggregation pipeline. They are not the same operation.

`lean()` returns plain objects without hydrated Mongoose document features such as save/change tracking. It is useful for read-only responses. It does not make MongoDB skip the query or its disk reads. Official reference: https://mongoosejs.com/docs/tutorials/lean.html

## 15. Receipts worked example

Group participants: [Tijil, Riya, Vidhanshu]. Tijil sends:

```text
readBy       = [Tijil]
deliveredTo  = [Tijil]
status       = sent
```

Riya receives it while another chat is open:

```text
readBy       = [Tijil]
deliveredTo  = [Tijil, Riya]
status       = sent
```

Status remains sent because the aggregate delivered state requires every participant. The arrays still record Riya's individual delivery.

Vidhanshu receives it: deliveredTo contains all three, so status becomes delivered. When both recipients acknowledge reading, readBy contains all three and status becomes read.

The sender begins in both arrays so the subset check can compare against the entire participant list. `$setUnion` prevents duplicates. The first pipeline stage updates arrays; the second computes status from those updated arrays. The read check has priority over the delivered check, so a later delivered acknowledgement cannot downgrade a read message.

The filter combines conversationId, message IDs and sender exclusion. Supplying a message ID from another conversation does not update it. Membership is checked first.

Read means the client acknowledged the displayed conversation, not proof that a human understood the text. Current visibility checks operate at chat/tab level, not on whether every individual message entered the viewport.

## 16. Real-time code

`realtime(server, app, secret)` constructs Socket.IO, stores it in Express settings and registers authentication plus connection handlers.

`io.use` is socket middleware. It validates the handshake token, resolves the user and records trusted uid/expiry in socket.data. The client does not choose an arbitrary user room.

`socket.join('user:' + uid)` joins a room that includes all this user's connected tabs. Server API notifications target these rooms. This project does not require each socket to join a separate room for every conversation.

`publishPresence(uid, status)` updates User status/lastSeen, finds shared conversations, gathers participant IDs into a Set and emits presence to each unique peer room. The Set avoids redundant broadcasts to the same person through several shared chats.

`sockets` is a Map from uid to connection count. It is process memory, not a collection. Increment on connect, decrement on disconnect. Set offline only when the final connection closes.

The typing handler validates the payload/ID, enforces a 400 ms per-socket interval, checks conversation membership and broadcasts to the other participants. The client expires typing timestamps after about 2.2 seconds, checked every second.

These functions use async database calls. Async/await suspends that function while the operation completes; it does not block the whole Node server like a synchronous CPU loop.

## 17. React state, helpers and effects

| State | Meaning |
| --- | --- |
| token, me | Login token and current user |
| convs, active | Sidebar records and selected conversation ID |
| messages, cursor | Loaded history and next older-page cursor |
| view, db | Chat/Database Studio mode and fetched database response |
| draft, editing, attach | Composer text, message being edited, optional attachment |
| search, query | Typed search input versus submitted search |
| filter | Local conversation-list filter |
| modal, users, selected, groupName | Dialog mode, user results, chosen participants and name |
| typing, connected | Temporary live activity/connection state |
| busy, error | Pending send/create action and visible error |

`useState` changes trigger rendering. `useRef` holds persistent mutable values without itself causing a render. Socket callbacks read activeRef/queryRef/viewRef so they see current values without rebuilding the connection each time selection changes.

| Function | What it does |
| --- | --- |
| api(url, options) | Fetch with JWT/JSON headers; parse JSON; throw on HTTP error; log out on 401 |
| run(fn) | Run asynchronous work and show errors instead of leaving unhandled rejections |
| logout() | Remove session token, reset UI, invalidate pending history and disconnect socket |
| loadConvs() | Fetch sidebar data and clear a deleted/inaccessible active chat |
| receipt(cid, rows, status) | Send IDs of other users' messages that lack this acknowledgement |
| loadMessages(cid, older, q) | Fetch page, discard stale response, merge older history, update cursor and acknowledge visible chat |
| title(c) | Return group title or the other user's name for a direct chat |
| openNew() | Load people and reset/open the conversation dialog |
| send(e) | Guard input/busy state, POST a new message or PATCH an edit, clear composer and reload |
| Icon, Avatar, time | Render icons, initials/group avatars and formatted time |

`requestId` handles out-of-order history responses. If request 8 finishes after request 9, request 8 must not overwrite request 9's results. The active-conversation check also rejects responses for a chat the user has left. `peopleRequest` performs a similar check for user search.

Effects load identity after token changes; connect/disconnect socket listeners; reload history after active/query/view changes; scroll after the last message changes; fetch Database Studio; and manage dialog focus. Cleanup removes the visibility listener and timer and disconnects the socket to avoid duplicate callbacks.

The socket effect's message:new handler acknowledges delivery/read and reloads the sidebar plus active history. Event handlers for changed/deleted messages and receipts reload relevant state too. This is simple but causes more reads than a finely tuned local cache. Refreshing an active chat currently replaces its history with the latest page, so a live refresh can discard older pages already loaded in the UI. That is a UI limitation, not loss of stored database records.

`Auth` reads form values, posts register/login and calls onLogin. `Attachment` returns link metadata to the parent; persistence happens when send posts the message. `Database` renders the already-fetched response and calls refresh. It never connects directly to MongoDB.

The JSX below the helpers conditionally renders login, chat, Database Studio and dialogs. Inline callbacks call the API for group creation/rename/deletion, profile changes and message deletion. `key={m._id}` gives React stable identity for message list items.

## 18. Security and integrity questions

**Why hash the password?** Verification should not require storing recoverable plaintext. Bcrypt compares the supplied password with the stored salted hash. Hashing is not encryption.

**What does JWT protect?** A signature helps verify token integrity and issuer possession of the secret. It does not encrypt the claims. HTTPS would protect transport in an internet deployment.

**Is logout server revocation?** No. It clears local sessionStorage and disconnects. A copied token can remain usable until expiry unless the account is deleted or the secret changes.

**Why validate on the server when HTML has required/type attributes?** Attackers or other clients can call the HTTP API without the form. Client validation is for usability; server validation is necessary.

**Why escape user search?** An input such as `.*` should be literal search text rather than an arbitrary regex pattern. Escaping does not guarantee an efficient index plan for substring search.

**Why use req.user._id for senderId?** It derives authorship from verified identity. Trusting a body-supplied senderId would let clients impersonate another author.

**Why transactions for cleanup?** Partial deletion could leave orphan messages or invalid conversation membership. MongoDB does not automatically cascade ref fields.

**Does the database enforce every rule?** No. Several rules, including membership and participant-count checks, live in route code. Mongoose validation is an application layer, and raw MongoDB writes can bypass it. Database-level schema validation is not configured here.

## 19. Tests as evidence

The API suite uses a unique test database and drops that test database afterward. It exercises models and Express routes against real MongoDB, with Supertest for HTTP and socket.io-client for socket behavior. It does not mock the transaction engine.

Read the assertion, not just the test title:

- Seed: 12 users + 6 conversations + 120 messages and no destructive reseed.
- Auth: hash hidden, duplicates rejected, invalid credentials rejected, protected routes blocked.
- Direct chats: same pair resolves to one conversation; outsiders cannot read/send.
- Message CRUD: preview follows updates, author-only mutation, text search and receipts work.
- Pagination: no duplicate or missing IDs across tied timestamps.
- Groups: all-recipient receipts and creator-only management.
- Rollback: deliberately throw after two writes, then verify both original states.
- Studio: scoped results and IXSCAN in the selected history plan.
- Sockets: invalid token rejection, typing, delivery isolation and multi-tab presence.
- Account deletion: password check and reference cleanup.
- Added regressions: receipt isolation/non-regression, concurrent direct-chat creation, malformed input.

Playwright tests the real UI: two-user live CRUD/search, Database Studio/dialog keyboard behavior, mobile layout, and hidden-chat read acknowledgement.

A passing test proves its assertions under that test's conditions. It is not proof of unlimited scale, security, serializable behavior across all operations or zero bugs.

## 20. What changes at scale?

The current design uses one server process and an in-memory presence Map. Multiple servers would require coordinated socket delivery and shared presence state. Redis is a possible component, not a dependency already present.

A multi-member replica set adds redundancy; sharding distributes data across partitions. They solve different problems. Do not say the current database is sharded. A sharding key needs workload analysis, including large/hot groups; choosing conversationId alone is not a complete scaling plan.

Conversation lists/unread aggregation are currently loaded without conversation-list pagination. User search uses regex. Broadcasting and repeatedly reloading history can generate substantial traffic. Those are concrete areas to measure before claiming a latency target.

A durable outbox, idempotency keys, backups and restore checks would address reliability gaps beyond the classroom implementation.

## 21. Mock viva

Answer these aloud without reading, then open the referenced code and justify the answer.

1. What happens between clicking Send and the second browser showing the message?
2. Which part writes the message: HTTP or Socket.IO?
3. Why are there three collections instead of one collection per chat?
4. Where is the many-to-many relationship represented?
5. Is participants an array of full users or references?
6. Why store lastMessage when the same text exists in messages?
7. What exactly does snapshot return, and what does it change? (It has no explicit return value; it changes/saves conv.)
8. What breaks if conv.save is outside the transaction?
9. What does `.session(session)` do?
10. Which invariant does the rollback test verify?
11. Is updateMany globally atomic without a transaction?
12. Why is directKey sorted, and why is an index still necessary?
13. What does `$setOnInsert` do when the conversation already exists?
14. Why does the unique index have a partialFilterExpression?
15. Explain every field and direction in the message-history index.
16. Why can a timestamp-only cursor miss a message?
17. Why do we request one extra message?
18. What does readBy: {$ne: uid} select here?
19. In `$group`, why is `_id` set to '$conversationId'?
20. How do populate and $lookup differ?
21. Why do read endpoints use lean?
22. How can a message be delivered to one person but still have status sent?
23. Why does the sender start in readBy?
24. Why are receipt arrays updated with set union?
25. Why is presence a count, not just a boolean?
26. What would fail if the server ran as two uncoordinated processes?
27. Why is a valid JWT insufficient to read a chat?
28. What survives if the server crashes after commit but before notification?
29. Does deleting an account delete every group it joined?
30. Which rules are enforced by MongoDB indexes, and which only by application code?
31. Can a group have two members after an account deletion?
32. Does IXSCAN alone prove the query is fast?
33. Is one replica-set member highly available?
34. Does the app really upload an attachment?
35. Which project claim has not been benchmarked?

## 22. Preparation sequence

First trace one message with the code open. Then explain the three schemas and their indexes from memory. Work through direct-chat uniqueness, the pagination example and the receipt example. Finally, explain the aggregation pipeline and deletion transaction line by line.

For a three-hour session, allocate roughly 30 minutes to architecture/schema, 50 to API and transactions, 35 to queries/indexes/receipts, 25 to React/socket behavior, and 40 to answering questions aloud. If time is short, prioritize models.js, member, snapshot, message creation, pagination, receipts and aggregation.

Your goal is to predict what the code does when input or conditions change. Memorizing a route name is not enough.
