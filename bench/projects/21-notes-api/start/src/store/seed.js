// Demo data (also used by the tests). Passwords are "pw-" + the username.
import { hashPassword } from '../auth/passwords.js';

export const DEMO_USERS = [
  { username: 'alex', role: 'admin' },
  { username: 'bea', role: 'editor' },
  { username: 'cam', role: 'viewer' },
  { username: 'dee', role: 'editor' },
];

export function seedDemo(store, at = '2026-03-01T08:00:00.000Z') {
  const ids = {};
  for (const u of DEMO_USERS) ids[u.username] = store.users.insert({ username: u.username, role: u.role, password: hashPassword(`pw-${u.username}`), createdAt: at }).id;
  const note = (owner, title, body, tags = []) => store.notes.insert({ ownerId: ids[owner], title, body, tags, createdAt: at, updatedAt: at }).id;
  const notes = {
    groceries: note('bea', 'Groceries', 'oat milk, lemons, rice', ['home']),
    roadmap: note('bea', 'Q2 roadmap', 'search, sharing, export', ['work']),
    recipe: note('dee', 'Dal recipe', 'lentils, cumin, garlic'),
    secret: note('alex', 'Server notes', 'rotate keys on the 1st', ['ops']),
  };
  store.shares.insert({ noteId: notes.groceries, userId: ids.cam, access: 'read' });
  store.shares.insert({ noteId: notes.roadmap, userId: ids.dee, access: 'edit' });
  store.shares.insert({ noteId: notes.roadmap, userId: ids.cam, access: 'edit' });
  return { users: ids, notes };
}
