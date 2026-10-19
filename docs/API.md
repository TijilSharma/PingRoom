# HTTP API reference

All routes except health, register and login require `Authorization: Bearer <token>`. JSON request bodies are limited to 32 KB. Invalid data returns 400, missing/invalid authentication 401, forbidden ownership operations 403, inaccessible resources 404 and duplicate identities 409.

| Method | Route |
| --- | --- |
| GET | `/api/health` |
| POST | `/api/auth/register` |
| POST | `/api/auth/login` |
| GET | `io` |
| GET | `/api/me` |
| PATCH | `/api/me` |
| DELETE | `/api/me` |
| GET | `io` |
| GET | `/api/users` |
| GET | `/api/conversations` |
| POST | `/api/conversations` |
| PATCH | `/api/conversations/:cid` |
| DELETE | `/api/conversations/:cid` |
| GET | `/api/conversations/:cid/messages` |
| POST | `/api/conversations/:cid/messages` |
| PATCH | `/api/messages/:mid` |
| DELETE | `/api/messages/:mid` |
| POST | `/api/conversations/:cid/receipts` |
| GET | `/api/database` |

## Main request shapes

```json
{"username":"new_user","email":"new@example.com","password":"AtLeast8Chars"}
{"type":"direct","participants":["OTHER_USER_OBJECT_ID"]}
{"type":"group","title":"Study group","participants":["USER_1_ID","USER_2_ID"]}
{"text":"Hello","attachment":{"url":"https://example.com/file.pdf","type":"file","fileName":"file.pdf"}}
{"status":"read","messageIds":["MESSAGE_OBJECT_ID"]}
```

Login omits username. Profile PATCH accepts username; group PATCH accepts title. Account DELETE requires password. Message PATCH replaces text and optional attachment. History accepts `limit` (1–100, default 30), `before` (opaque cursor) and `q` (MongoDB text search). User search accepts `q`.

History returns `{messages, nextCursor}`. Message creation returns 201 and the populated message. Conversation creation returns 201 even when reusing an existing direct conversation. Receipt acknowledgements return `{ok:true}` and do not reveal message IDs outside the specified conversation.

## Socket.IO

Connect with `auth: {token}`. Server events: `message:new`, `message:changed`, `message:deleted`, `conversations:changed`, `receipts:changed`, `presence`, `typing`. The client sends only `typing` with a conversationId. Message writes use authenticated HTTP. Presence is online/offline, while typing expires in the UI. Refresh persisted state on reconnect.
