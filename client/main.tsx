import React, { Component, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { clearPhotoCache } from '../lib/firebase-api';
import Studio from '../app/studio';
import '../app/globals.css';
class ErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="empty-state"><h1>Let’s reopen your studio.</h1><p>An unexpected problem interrupted the page. Your saved projects remain in your account.</p><button className="button primary" onClick={() => location.reload()}>Reload studio</button></main> : this.props.children; }
}
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => onAuthStateChanged(auth, next => { clearPhotoCache(); setUser(next); setReady(true); }), []);
  if (!ready) return <main className="empty-state" aria-busy="true"><h1>SecondCut</h1><p>Opening your studio…</p></main>;
  return <Studio user={user ? { name: user.displayName || (user.isAnonymous ? 'Guest' : user.email?.split('@')[0]) || 'Maker', email: user.email || `guest:${user.uid}` } : null} />;
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
