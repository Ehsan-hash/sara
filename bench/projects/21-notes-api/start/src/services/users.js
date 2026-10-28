import { HttpError } from '../http/errors.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { ROLES } from '../middleware/roles.js';
import { iso } from '../util/clock.js';
import { oneOf, requireObject, requireString } from '../util/validate.js';

/** Users as the API shows them (never the password hash). */
export const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt });

export function userService({ store, clock }) {
  return {
    byCredentials(username, password) {
      const u = store.users.find((x) => x.username === username && !x.disabled)[0];
      return u && verifyPassword(password, u.password) ? u : undefined;
    },
    list() {
      return store.users.find().map(publicUser);
    },
    create(body) {
      requireObject(body);
      const username = requireString(body, 'username', { min: 2, max: 32 }).toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(username)) throw new HttpError(400, 'invalid', 'Usernames use letters, digits, - and _.');
      if (store.users.find((u) => u.username === username).length) throw new HttpError(409, 'taken', 'That username is taken.');
      const password = requireString(body, 'password', { min: 8, max: 200 });
      const role = oneOf(body, 'role', ROLES);
      return publicUser(store.users.insert({ username, role, password: hashPassword(password), createdAt: iso(clock) }));
    },
    setRole(id, body) {
      requireObject(body);
      const role = oneOf(body, 'role', ROLES);
      const u = store.users.update(id, { role });
      if (!u) throw new HttpError(404, 'not_found', 'No such user.');
      return publicUser(u);
    },
  };
}
