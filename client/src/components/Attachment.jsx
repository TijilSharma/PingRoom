import React, { useState } from 'react';
export default function Attachment({ onSave }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <h2>Share a link.</h2>
      <p>Attach an image or file hosted at an HTTP(S) URL.</p>
      <label>
        URL
        <input
          name="url"
          type="url"
          pattern="https?://.*"
          required
          placeholder="https://…"
        />
      </label>
      <label>
        File name
        <input
          name="fileName"
          required
          maxLength={150}
          placeholder="schema.png"
        />
      </label>
      <label>
        Type
        <select name="type">
          <option value="file">File</option>
          <option value="image">Image</option>
        </select>
      </label>
      <button className="primary">Attach link</button>
    </form>
  );
}
