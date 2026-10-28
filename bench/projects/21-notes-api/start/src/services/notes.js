// Note rules (docs/AUTH.md, docs/API.md). Throws HttpErrors; knows nothing about HTTP otherwise.
import { forbidden, HttpError, notFound } from '../http/errors.js';
import { canDelete, canEdit, canRead, canShare } from '../middleware/access.js';
import { hasRole } from '../middleware/roles.js';
import { iso } from '../util/clock.js';
import { oneOf, optionalString, optionalTags, requireObject, requireString } from '../util/validate.js';

export function noteService({ store, clock }) {
  const readable = (user, id) => {
    const note = store.notes.get(id);
    if (!note || !canRead(store, user, note)) throw notFound();
    return note;
  };
  return {
    list(user) {
      return store.notes
        .find((n) => canRead(store, user, n))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id, 'en', { numeric: true }));
    },
    get(user, id) {
      return readable(user, id);
    },
    create(user, body) {
      if (!hasRole(user, 'editor')) throw forbidden('Viewers cannot create notes.');
      requireObject(body);
      const at = iso(clock);
      return store.notes.insert({
        ownerId: user.id,
        title: requireString(body, 'title', { max: 120 }),
        body: optionalString(body, 'body', { max: 20_000 }) ?? '',
        tags: optionalTags(body) ?? [],
        createdAt: at,
        updatedAt: at,
      });
    },
    update(user, id, body) {
      const note = readable(user, id);
      if (!canEdit(store, user, note)) throw forbidden('You cannot edit this note.');
      requireObject(body);
      const patch = {};
      if (body.title !== undefined) patch.title = requireString(body, 'title', { max: 120 });
      if (body.body !== undefined) patch.body = optionalString(body, 'body', { max: 20_000 });
      if (body.tags !== undefined) patch.tags = optionalTags(body);
      if (!Object.keys(patch).length) throw new HttpError(400, 'invalid', 'Nothing to change.');
      return store.notes.update(id, { ...patch, updatedAt: iso(clock) });
    },
    remove(user, id) {
      const note = readable(user, id);
      if (!canDelete(store, user, note)) throw forbidden('Only the owner or an admin can delete a note.');
      store.notes.remove(id);
      store.shares.removeWhere((s) => s.noteId === id);
    },
    share(user, id, body) {
      const note = readable(user, id);
      if (!canShare(store, user, note)) throw forbidden('Only the owner can share this note.');
      requireObject(body);
      const userId = requireString(body, 'userId', { max: 40 });
      const access = oneOf(body, 'access', ['read', 'edit']);
      if (!store.users.get(userId)) throw new HttpError(400, 'invalid', 'No such user.');
      if (userId === note.ownerId) throw new HttpError(400, 'invalid', 'The owner already has the note.');
      store.shares.removeWhere((s) => s.noteId === id && s.userId === userId);
      store.shares.insert({ noteId: id, userId, access });
      return { noteId: id, userId, access };
    },
  };
}
