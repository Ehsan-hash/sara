// Who may do what with a note (docs/AUTH.md). Pure functions; the services call them.
import { hasRole } from './roles.js';

/** The share between a note and a user, if any: 'read' | 'edit' | undefined. */
export function shareFor(store, note, user) {
  return store.shares.find((s) => s.noteId === note.id && s.userId === user.id)[0]?.access;
}

export function canRead(store, user, note) {
  if (note.ownerId === user.id || hasRole(user, 'admin')) return true;
  return shareFor(store, note, user) !== undefined;
}

export function canEdit(store, user, note) {
  if (!hasRole(user, 'editor')) return false;
  if (note.ownerId === user.id || hasRole(user, 'admin')) return true;
  return shareFor(store, note, user) === 'edit';
}

export function canDelete(store, user, note) {
  return note.ownerId === user.id || hasRole(user, 'admin');
}

export function canShare(store, user, note) {
  return hasRole(user, 'admin') || (note.ownerId === user.id && hasRole(user, 'editor'));
}
