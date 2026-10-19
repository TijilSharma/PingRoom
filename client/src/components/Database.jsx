import React, { useState } from 'react';
export default function Database({ db, refresh }) {
  if (!db) return <div className="studio">Loading database insights…</div>;
  return (
    <div className="studio">
      <div className="studio-heading">
        <div>
          <span className="eyebrow">UNDER THE HOOD</span>
          <h1>
            Database studio
            <span className="brand-dot" />
          </h1>
          <p>A live look at the conversations behind the connection.</p>
        </div>
        <button className="secondary" onClick={refresh}>
          Refresh data ↻
        </button>
      </div>
      <div className="stat-grid">
        {Object.entries(db.counts).map(([name, n]) => (
          <div className="stat" key={name}>
            <span>{name.toUpperCase()}</span>
            <strong>{n}</strong>
            <small>documents in collection</small>
          </div>
        ))}
        <div className="stat green">
          <span>DATABASE</span>
          <strong>MongoDB</strong>
          <small>
            {db.replicaSet ? `Replica set · ${db.replicaSet}` : 'Standalone'}
          </small>
        </div>
      </div>
      <p className="scope">{db.scope}</p>
      <div className="studio-grid">
        <section className="panel">
          <h2>Conversation activity</h2>
          <p>Aggregation · $group → $lookup → $sort</p>
          {db.activity.byConversation.map((c) => (
            <div className="activity-row" key={c._id}>
              <span>{c.title || 'Direct conversation'}</span>
              <div>
                <i
                  style={{
                    width: `${Math.max(2, (c.messages / Math.max(...db.activity.byConversation.map((r) => r.messages))) * 100)}%`,
                  }}
                />
              </div>
              <b>{c.messages}</b>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Message delivery</h2>
          <p>Per-recipient receipts, aggregated live</p>
          <div className="delivery-stats">
            {['sent', 'delivered', 'read'].map((status) => (
              <div key={status}>
                <strong>
                  {db.activity.statuses.find((s) => s._id === status)?.count ||
                    0}
                </strong>
                <span>{status}</span>
              </div>
            ))}
          </div>
          <div className="transaction-note">
            <b>↔ Atomic by design</b>
            <p>
              Message writes and conversation previews commit together. Deleting
              a conversation removes its messages in the same transaction.
            </p>
          </div>
        </section>
        <section className="panel">
          <h2>Indexes that do the work</h2>
          <p>Unique, compound, multikey & text indexes</p>
          {Object.entries(db.indexes).map(([name, rows]) => (
            <div className="index-group" key={name}>
              <h3>{name}</h3>
              {rows.map((row) => (
                <code key={row.name}>
                  {JSON.stringify(row.key)} {row.unique ? '· UNIQUE' : ''}
                </code>
              ))}
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Query inspection</h2>
          <p>Live execution plan · latest 30 messages</p>
          {db.executionStats && (
            <div className="query-stats">
              {Object.entries(db.executionStats).map(([k, v]) => (
                <span key={k}>
                  <strong>{v}</strong>
                  {k}
                </span>
              ))}
            </div>
          )}
          <details>
            <summary>Inspect MongoDB query plan</summary>
            <pre>{JSON.stringify(db.queryPlan, null, 2)}</pre>
          </details>
          <h3>Message volume by day</h3>
          {db.activity.byDay.map((d) => (
            <div className="daily" key={d._id}>
              <span>{d._id}</span>
              <b>{d.messages} messages</b>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
