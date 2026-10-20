# Final review demonstration

## Before class

1. Run `npm run db:up`, `npm run build`, then `npm start`.
2. Open http://localhost:3100 and log in as tijil. In an incognito window, log in as aria. Both demo passwords are `PingRoom@123`.
3. Keep the code editor on `server/models.js` and the final pitch deck ready.
4. Run `npm test`. Keep the terminal result available. Docker must stay running.
5. The demo runs locally without internet after dependencies and the MongoDB image are installed. Attachment destinations still require connectivity.

## Eight minute route

| Time | Action | Explanation |
| --- | --- | --- |
| 0:00 | State the problem and open the chat | Small project groups need persistent shared conversations |
| 0:45 | Show three schemas | Users are shared, participants are bounded, messages are unbounded |
| 1:45 | Open Database lab in both browsers and send a message | HTTP commits to MongoDB; Socket.IO publishes after commit |
| 2:30 | Type, edit and delete a message | Membership and author checks protect writes; preview stays consistent |
| 3:15 | Start a direct chat, then select two users for a named group | Unique sorted pair key prevents duplicate direct chats |
| 4:00 | Search messages; show history pagination if available | Text index handles search; time plus ObjectId handles stable paging |
| 4:45 | Open Database Studio and query plan | Explain IXSCAN, keys examined, documents examined and returned rows |
| 5:45 | Show `mongoose.connection.transaction` in app.js | Both writes commit or neither does |
| 6:30 | Show passing tests | Include rollback, authorization, tied-timestamp pagination and live delivery |
| 7:15 | State limitations and future work | Single-node replica set, URL attachments, no load-tested latency claim |

The seed has 20 messages per conversation and the UI page size is 30. To demonstrate the “Load older messages” button, add at least 11 messages first, or show the automated pagination test, which creates 65 tied-timestamp records in an isolated database. Do not claim the seed alone exercises multiple UI pages.

## If something fails

- MongoDB or Redis connection error: `docker compose ps`, then `npm run db:up`.
- Port busy: close the previous server, or change PORT and restart. Browser tests expect 3100.
- Empty/missing frontend: `npm run build`, then refresh.
- Login expiry: sign in again. JWT lifetime is one day.
- No live events: check the Connected indicator and refresh both sessions.
- Do not delete data volumes to fix a connection problem.

## Suggested opening

“PingRoom is a self-hosted chat application built with MongoDB, Express, React and Node. My database design separates messages from conversations, embeds bounded membership arrays, and caches the latest message. I will show how transactions keep that cache correct and how indexes support history queries.”
