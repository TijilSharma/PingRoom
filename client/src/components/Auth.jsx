import React, { useState } from 'react';
export default function Auth({ api, onLogin, error, setError }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-form-wrap">
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const data = Object.fromEntries(new FormData(e.currentTarget));
          try {
            onLogin(
              await api(`/auth/${register ? 'register' : 'login'}`, {
                method: 'POST',
                body: JSON.stringify(data),
              }),
            );
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">
          {register ? 'COME ON IN' : 'YOUR PEOPLE ARE HERE'}
        </span>
        <h2>{register ? 'Find your room.' : 'Welcome back.'}</h2>
        <p>
          {register
            ? 'A new account. A whole lot of possibilities.'
            : 'Pick up right where you left off.'}
        </p>
        {register && (
          <label>
            Username
            <input
              name="username"
              required
              pattern="[a-z0-9_]{2,30}"
              placeholder="Your handle"
            />
          </label>
        )}
        <label>
          Email address
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            defaultValue={register ? '' : 'tijil@vitstudent.ac.in'}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            placeholder="At least 8 characters"
            defaultValue={register ? '' : 'PingRoom@123'}
          />
        </label>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? 'One moment…'
            : register
              ? 'Create account →'
              : 'Let’s talk →'}
        </button>
        <p className="auth-switch">
          {register ? 'Already part of the room?' : 'New around here?'}{' '}
          <button
            type="button"
            onClick={() => {
              setRegister(!register);
              setError('');
            }}
          >
            {register ? 'Log in' : 'Create an account'}
          </button>
        </p>
        <div className="demo-note">
          <strong>Take a look around</strong>
          <p>
            Demo: tijil@vitstudent.ac.in
            <br />
            Password: PingRoom@123
            <br />
            Try aria@vitstudent.ac.in in another browser to chat.
          </p>
        </div>
      </form>
    </div>
  );
}
