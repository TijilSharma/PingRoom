import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';
import Auth from './components/Auth.jsx';
import Attachment from './components/Attachment.jsx';
import Database from './components/Database.jsx';
const Icon = ({ name, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {
      {
        chat: (
          <>
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z" />
            <path d="M8 11h8m-8 4h5" />
          </>
        ),
        database: (
          <>
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
          </>
        ),
        plus: <path d="M12 5v14M5 12h14" />,
        search: (
          <>
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 5 5" />
          </>
        ),
        send: (
          <>
            <path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" />
          </>
        ),
        link: (
          <>
            <path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0m2 2 2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0" />
          </>
        ),
        logout: (
          <>
            <path d="M9 4H4v16h5m5-12 4 4-4 4m-5-4h12" />
          </>
        ),
        people: (
          <>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5" />
          </>
        ),
      }[name]
    }
  </svg>
);
const time = (d) =>
  new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const Avatar = ({ name = '?', group = false, small = false }) => (
  <span
    className={`avatar ${group ? 'group' : ''} ${small ? 'small' : ''}`}
    style={{
      '--hue': [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360,
    }}
  >
    {group ? <Icon name="people" /> : name.slice(0, 2).toUpperCase()}
  </span>
);
function App() {
  const [token, setToken] = useState(
    sessionStorage.getItem('pingroom-token') || '',
  );
  const [me, setMe] = useState(null),
    [convs, setConvs] = useState([]),
    [active, setActive] = useState(null),
    [messages, setMessages] = useState([]),
    [cursor, setCursor] = useState(null);
  const [view, setView] = useState('chat'),
    [db, setDb] = useState(null),
    [error, setError] = useState(''),
    [filter, setFilter] = useState(''),
    [draft, setDraft] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [modal, setModal] = useState(null),
    [users, setUsers] = useState([]),
    [selected, setSelected] = useState([]),
    [groupName, setGroupName] = useState(''),
    [typing, setTyping] = useState({}),
    [editing, setEditing] = useState(null),
    [attach, setAttach] = useState(null),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const socket = useRef(null),
    activeRef = useRef(null),
    bottom = useRef(null),
    requestId = useRef(0),
    queryRef = useRef(''),
    viewRef = useRef('chat'),
    peopleRequest = useRef(0);
  activeRef.current = active;
  queryRef.current = query;
  viewRef.current = view;
  const api = async (url, options = {}) => {
    const r = await fetch(`/api${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 401 && token) logout();
      throw Error(data.error || 'Request failed');
    }
    return data;
  };
  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => setError(e.message));
  const logout = () => {
    sessionStorage.removeItem('pingroom-token');
    setToken('');
    setMe(null);
    setActive(null);
    setConvs([]);
    setMessages([]);
    setModal(null);
    setDb(null);
    setView('chat');
    setError('');
    setConnected(false);
    requestId.current++;
    socket.current?.disconnect();
  };
  const loadConvs = async () => {
    const rows = await api('/conversations');
    setConvs(rows);
    if (activeRef.current && !rows.some((c) => c._id === activeRef.current))
      setActive(null);
  };
  const receipt = (cid, rows, status) => {
    const ids = rows
      .filter(
        (m) =>
          m.senderId._id !== me?._id &&
          !(status === 'read' ? m.readBy : m.deliveredTo).includes(me?._id),
      )
      .map((m) => m._id);
    if (ids.length)
      return api(`/conversations/${cid}/receipts`, {
        method: 'POST',
        body: JSON.stringify({ status, messageIds: ids }),
      });
  };
  const loadMessages = async (cid, older = null, q = queryRef.current) => {
    const sequence = ++requestId.current;
    const data = await api(
      `/conversations/${cid}/messages?limit=30${older ? `&before=${encodeURIComponent(older)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    );
    if (activeRef.current !== cid || sequence !== requestId.current) return;
    setMessages((prev) =>
      older
        ? [
            ...data.messages,
            ...prev.filter((m) => !data.messages.some((n) => n._id === m._id)),
          ]
        : data.messages,
    );
    setCursor(data.nextCursor);
    if (document.visibilityState === 'visible' && viewRef.current === 'chat')
      await receipt(cid, data.messages, 'read');
  };
  useEffect(() => {
    if (token)
      run(async () => {
        setMe(await api('/me'));
        await loadConvs();
      });
  }, [token]);
  useEffect(() => {
    if (!token || !me) return;
    const s = io({ auth: { token } });
    socket.current = s;
    s.on('connect', () => {
      setConnected(true);
      run(async () => {
        await loadConvs();
        if (activeRef.current) await loadMessages(activeRef.current);
      });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => setError(e.message));
    s.on('conversations:changed', () => run(loadConvs));
    s.on('presence', () => run(loadConvs));
    s.on('message:new', (m) =>
      run(async () => {
        await receipt(
          m.conversationId,
          [m],
          activeRef.current === m.conversationId &&
            viewRef.current === 'chat' &&
            document.visibilityState === 'visible'
            ? 'read'
            : 'delivered',
        );
        await loadConvs();
        if (activeRef.current === m.conversationId)
          await loadMessages(m.conversationId);
      }),
    );
    for (const event of [
      'message:changed',
      'message:deleted',
      'receipts:changed',
    ])
      s.on(event, (m) =>
        run(async () => {
          await loadConvs();
          if (activeRef.current === m.conversationId)
            await loadMessages(m.conversationId);
        }),
      );
    s.on('typing', (v) =>
      setTyping((t) => ({ ...t, [v.conversationId]: Date.now() })),
    );
    const visibility = () => {
      if (
        document.visibilityState === 'visible' &&
        viewRef.current === 'chat' &&
        activeRef.current
      )
        run(() => loadMessages(activeRef.current));
    };
    document.addEventListener('visibilitychange', visibility);
    const interval = setInterval(
      () =>
        setTyping((t) =>
          Object.fromEntries(
            Object.entries(t).filter(([, at]) => Date.now() - at < 2200),
          ),
        ),
      1000,
    );
    return () => {
      s.disconnect();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [token, me?._id]);
  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setDraft('');
    setEditing(null);
    setAttach(null);
    if (active && me) run(() => loadMessages(active));
  }, [active, query, me?._id, view]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.at(-1)?._id]);
  useEffect(() => {
    if (view === 'database' && token)
      run(async () => setDb(await api('/database')));
  }, [view, token]);
  const conv = convs.find((c) => c._id === active);
  const title = (c) =>
    c.type === 'group'
      ? c.title
      : c.participants.find((p) => p._id !== me?._id)?.username ||
        'Direct conversation';
  // Keep the dialog keyboard-accessible and restore focus to its opener.
  useEffect(() => {
    if (!modal) return;
    const opener = document.activeElement;
    const dialog = document.querySelector('[role=dialog]');
    const focusable = () =>
      [...dialog.querySelectorAll('button, input, select, a[href]')].filter(
        (el) => !el.disabled,
      );
    focusable()[0]?.focus();
    const keydown = (e) => {
      if (e.key === 'Escape') setModal(null);
      if (e.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener('keydown', keydown);
    return () => {
      dialog.removeEventListener('keydown', keydown);
      opener?.focus();
    };
  }, [modal]);
  const openNew = () =>
    run(async () => {
      setUsers(await api('/users'));
      setSelected([]);
      setGroupName('');
      setModal('new');
    });
  const send = (e) => {
    e.preventDefault();
    if (busy || (!draft.trim() && !attach)) return;
    setBusy(true);
    run(async () => {
      await api(
        editing ? `/messages/${editing}` : `/conversations/${active}/messages`,
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            text: draft,
            ...(attach ? { attachment: attach } : {}),
          }),
        },
      );
      setDraft('');
      setAttach(null);
      setEditing(null);
      await loadMessages(active);
      await loadConvs();
    }).finally(() => setBusy(false));
  };
  if (!token || !me)
    return (
      <div className="auth-page">
        <div className="auth-story">
          <div className="brand">
            <Icon name="chat" size={32} /> PingRoom
            <span className="brand-dot" />
          </div>
          <div>
            <span className="eyebrow">GOOD CONVERSATIONS START HERE</span>
            <h1>
              A little ping.
              <br />A lot closer.
            </h1>
            <p>
              Your people, your projects, your next big idea.
              <br />
              Bring the conversation together.
            </p>
            <div className="orbit">
              <span>hello.</span>
              <span>hey there!</span>
              <span>let’s build something ↗</span>
            </div>
          </div>
          <span className="auth-foot">A space for every conversation.</span>
        </div>
        <Auth
          api={api}
          onLogin={(data) => {
            sessionStorage.setItem('pingroom-token', data.token);
            setToken(data.token);
            setMe(data.user);
          }}
          error={error}
          setError={setError}
        />
      </div>
    );
  return (
    <div className="app-shell">
      <nav className="rail">
        <div className="mark">
          <Icon name="chat" size={26} />
        </div>
        <button
          className={view === 'chat' ? 'current' : ''}
          title="Messages"
          onClick={() => setView('chat')}
        >
          <Icon name="chat" />
        </button>
        <button
          className={view === 'database' ? 'current' : ''}
          title="Database studio"
          onClick={() => setView('database')}
        >
          <Icon name="database" />
        </button>
        <div className="rail-bottom">
          <button
            title="Edit profile"
            onClick={() => {
              setGroupName(me.username);
              setModal('profile');
            }}
          >
            <Avatar name={me.username} small />
          </button>
          <button title="Log out" onClick={logout}>
            <Icon name="logout" />
          </button>
        </div>
      </nav>
      <main className="workspace">
        <header className="topbar">
          <div className="brand">
            PingRoom
            <span className="brand-dot" />
          </div>
          <span className="tagline">A space for every conversation</span>
          <div className="connection">
            <i className={connected ? 'live' : ''} />
            {connected ? 'Connected' : 'Reconnecting'}
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {view === 'database' ? (
          <Database
            db={db}
            refresh={() => run(async () => setDb(await api('/database')))}
          />
        ) : (
          <div className={`chat-layout ${active ? 'has-active' : ''}`}>
            <aside className="sidebar">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">YOUR CORNER</span>
                  <h1>
                    Messages <span>{convs.length}</span>
                  </h1>
                </div>
                <button
                  className="new-button"
                  title="New conversation"
                  onClick={openNew}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <label className="search">
                <Icon name="search" size={17} />
                <input
                  aria-label="Search conversations"
                  placeholder="Find a conversation"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <div className="list-label">
                ALL CONVERSATIONS <span>↓</span>
              </div>
              <div className="conversation-list">
                {convs
                  .filter((c) =>
                    (
                      title(c) +
                      ' ' +
                      c.participants.map((p) => p.username).join(' ')
                    )
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      key={c._id}
                      className={`conversation ${active === c._id ? 'selected' : ''}`}
                      onClick={() => {
                        setQuery('');
                        setSearch('');
                        setActive(c._id);
                      }}
                    >
                      <Avatar name={title(c)} group={c.type === 'group'} />
                      <div className="conversation-text">
                        <div>
                          <strong>{title(c)}</strong>
                          <time>
                            {time(c.lastMessage?.sentAt || c.createdAt)}
                          </time>
                        </div>
                        <div>
                          <p>{c.lastMessage?.text || 'Say the first hello'}</p>
                          {c.unread > 0 && <b className="unread">{c.unread}</b>}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
              <div className="sidebar-note">
                <span>○</span>
                <p>
                  A little less distance.
                  <br />
                  <strong>A little more connection.</strong>
                </p>
              </div>
            </aside>
            <section className="chat">
              {conv ? (
                <>
                  <header className="chat-header">
                    <button className="back" onClick={() => setActive(null)}>
                      ←
                    </button>
                    <Avatar name={title(conv)} group={conv.type === 'group'} />
                    <div className="chat-heading">
                      <h2>{title(conv)}</h2>
                      <p>
                        {conv.type === 'group'
                          ? `${conv.participants.length} members · ${conv.participants.map((p) => p.username).join(', ')}`
                          : conv.participants.find((p) => p._id !== me._id)
                              ?.status || 'offline'}
                      </p>
                    </div>
                    {conv.ownerId === me._id && (
                      <div className="header-actions">
                        {conv.type === 'group' && (
                          <button
                            onClick={() => {
                              setGroupName(conv.title);
                              setModal('rename');
                            }}
                          >
                            Rename
                          </button>
                        )}
                        <button onClick={() => setModal('delete-conversation')}>
                          Delete
                        </button>
                      </div>
                    )}
                  </header>
                  <form
                    className="message-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery(search);
                    }}
                  >
                    <Icon name="search" size={16} />
                    <input
                      aria-label="Search messages"
                      placeholder="Search this conversation…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <button>Search</button>
                    {query && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          setSearch('');
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </form>
                  <div className="message-list">
                    {cursor && (
                      <button
                        className="older"
                        onClick={() => run(() => loadMessages(active, cursor))}
                      >
                        Load older messages
                      </button>
                    )}
                    <div className="date-divider">
                      <span>
                        {query
                          ? `Search results for “${query}”`
                          : 'You’re in good company'}
                      </span>
                    </div>
                    {!messages.length && (
                      <div className="empty-messages">
                        {query
                          ? 'No messages matched your search.'
                          : 'Every conversation starts with a hello.'}
                      </div>
                    )}
                    {messages.map((m, index) => {
                      const mine = m.senderId._id === me._id;
                      return (
                        <React.Fragment key={m._id}>
                          {(index === 0 ||
                            new Date(m.createdAt).toDateString() !==
                              new Date(
                                messages[index - 1].createdAt,
                              ).toDateString()) && (
                            <div className="date-label">
                              {new Date(m.createdAt).toLocaleDateString([], {
                                month: 'long',
                                day: 'numeric',
                              })}
                            </div>
                          )}
                          <article className={`message ${mine ? 'mine' : ''}`}>
                            {!mine && (
                              <Avatar name={m.senderId.username} small />
                            )}
                            <div className="message-content">
                              {!mine && (
                                <strong className="sender">
                                  {m.senderId.username}
                                </strong>
                              )}
                              <div className="bubble">
                                {m.text && <p>{m.text}</p>}
                                {m.attachment?.url && (
                                  <a
                                    href={m.attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    ↗ {m.attachment.fileName}
                                  </a>
                                )}
                              </div>
                              <div className="message-meta">
                                <time>{time(m.createdAt)}</time>
                                {m.editedAt && <span>edited</span>}
                                {mine && (
                                  <>
                                    <span
                                      className={
                                        m.status === 'read' ? 'read' : ''
                                      }
                                    >
                                      {m.status === 'sent' ? '✓' : '✓✓'}{' '}
                                      {m.status}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setEditing(m._id);
                                        setDraft(m.text);
                                        setAttach(
                                          m.attachment?.url
                                            ? m.attachment
                                            : null,
                                        );
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() =>
                                        setModal({ deleteMessage: m._id })
                                      }
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </article>
                        </React.Fragment>
                      );
                    })}
                    <div ref={bottom} />
                  </div>
                  <div className="typing">
                    {typing[active] ? 'Someone is typing…' : ' '}
                  </div>
                  <form className="composer" onSubmit={send}>
                    {editing && (
                      <div className="composer-info">
                        Editing message{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setDraft('');
                            setAttach(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {attach && (
                      <div className="composer-info">
                        ↗ {attach.fileName}
                        <button type="button" onClick={() => setAttach(null)}>
                          Remove
                        </button>
                      </div>
                    )}
                    <div className="compose-row">
                      <button
                        type="button"
                        title="Attach a link"
                        onClick={() => setModal('attachment')}
                      >
                        <Icon name="link" />
                      </button>
                      <input
                        aria-label="Message"
                        placeholder={`Message ${title(conv)}…`}
                        value={draft}
                        maxLength={4000}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          socket.current?.emit('typing', {
                            conversationId: active,
                          });
                        }}
                      />
                      <button
                        className="send"
                        disabled={busy || (!draft.trim() && !attach)}
                        title={editing ? 'Save message' : 'Send message'}
                      >
                        <Icon name="send" />
                      </button>
                    </div>
                    <span className="compose-hint">
                      Enter to {editing ? 'save' : 'send'} · Good things start
                      with a conversation
                    </span>
                  </form>
                </>
              ) : (
                <div className="welcome">
                  <div className="welcome-icon">
                    <Icon name="chat" size={50} />
                  </div>
                  <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                  <h1>Hey, {me.username}.</h1>
                  <p>
                    A familiar face. A fresh idea. A quick hello.
                    <br />
                    Pick a conversation and see where it goes.
                  </p>
                  <button className="primary" onClick={openNew}>
                    Start a conversation <Icon name="plus" size={17} />
                  </button>
                  <div className="welcome-features">
                    <span>◌ Live conversations</span>
                    <span>◎ Your people, together</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Conversation action"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              ×
            </button>
            {modal === 'new' ? (
              <>
                <span className="eyebrow">SAY HELLO</span>
                <h2>Make a new connection.</h2>
                <p>Select one person for a direct chat, or more for a group.</p>
                <input
                  placeholder="Search people"
                  aria-label="Search people"
                  onChange={(e) => {
                    const q = e.target.value;
                    const sequence = ++peopleRequest.current;
                    run(async () => {
                      const rows = await api(
                        `/users?q=${encodeURIComponent(q)}`,
                      );
                      if (sequence === peopleRequest.current) setUsers(rows);
                    });
                  }}
                />
                <div className="people-list">
                  {users.map((u) => (
                    <label key={u._id}>
                      <Avatar name={u.username} small />
                      <span>{u.username}</span>
                      <input
                        type="checkbox"
                        checked={selected.includes(u._id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, u._id]
                              : s.filter((i) => i !== u._id),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                {selected.length > 1 && (
                  <input
                    placeholder="Group name"
                    aria-label="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                )}
                <button
                  className="primary"
                  disabled={!selected.length || busy}
                  onClick={() => {
                    setBusy(true);
                    run(async () => {
                      const c = await api('/conversations', {
                        method: 'POST',
                        body: JSON.stringify({
                          type: selected.length > 1 ? 'group' : 'direct',
                          participants: selected,
                          ...(selected.length > 1 ? { title: groupName } : {}),
                        }),
                      });
                      await loadConvs();
                      setQuery('');
                      setSearch('');
                      setActive(c._id);
                      setModal(null);
                    }).finally(() => setBusy(false));
                  }}
                >
                  Start conversation →
                </button>
              </>
            ) : modal === 'attachment' ? (
              <Attachment
                onSave={(a) => {
                  setAttach(a);
                  setModal(null);
                }}
              />
            ) : ['rename', 'profile'].includes(modal) ? (
              <>
                <h2>{modal === 'profile' ? 'Your profile' : 'Rename group'}</h2>
                <input
                  aria-label="Name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
                <button
                  className="primary"
                  onClick={() =>
                    run(async () => {
                      const r = await api(
                        modal === 'profile'
                          ? '/me'
                          : `/conversations/${active}`,
                        {
                          method: 'PATCH',
                          body: JSON.stringify(
                            modal === 'profile'
                              ? { username: groupName }
                              : { title: groupName },
                          ),
                        },
                      );
                      if (modal === 'profile') setMe(r);
                      await loadConvs();
                      setModal(null);
                    })
                  }
                >
                  Save changes
                </button>
                {modal === 'profile' && (
                  <button
                    className="delete-account"
                    onClick={() => setModal('delete-account')}
                  >
                    Delete my account
                  </button>
                )}
              </>
            ) : modal === 'delete-account' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const password = new FormData(e.currentTarget).get(
                    'password',
                  );
                  run(async () => {
                    await api('/me', {
                      method: 'DELETE',
                      body: JSON.stringify({ password }),
                    });
                    setModal(null);
                    logout();
                  });
                }}
              >
                <h2>Delete your account?</h2>
                <p>
                  This permanently removes your account, your messages, your
                  direct chats, and groups you created. Other groups remain
                  without your membership or messages.
                </p>
                <label>
                  Confirm your password
                  <input name="password" type="password" required />
                </label>
                <button className="danger">
                  Delete my account permanently
                </button>
              </form>
            ) : (
              <>
                <h2>
                  Delete {modal.deleteMessage ? 'message' : 'conversation'}?
                </h2>
                <p>
                  {modal.deleteMessage
                    ? 'This message will be removed for everyone.'
                    : 'This conversation and all its messages will be permanently removed for everyone.'}
                </p>
                <button
                  className="danger"
                  onClick={() =>
                    run(async () => {
                      await api(
                        modal.deleteMessage
                          ? `/messages/${modal.deleteMessage}`
                          : `/conversations/${active}`,
                        { method: 'DELETE' },
                      );
                      if (modal.deleteMessage) await loadMessages(active);
                      else setActive(null);
                      await loadConvs();
                      setModal(null);
                    })
                  }
                >
                  Delete permanently
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
