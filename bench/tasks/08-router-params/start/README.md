# router

```js
const r = createRouter().add('GET', '/users/:id', showUser).add('GET', '/files/*path', sendFile);
r.match('GET', '/users/42'); // { handler: showUser, params: { id: '42' } }
```

- `add(method, pattern, handler)` registers a route and returns the router (so calls chain).
- `match(method, path)` returns `{ handler, params }` for the best route, or `null`.
- A path is split into segments at `/`. Empty segments are ignored, so `/users/42/` is the same
  as `/users/42`. Anything after `?` (the query string) is ignored.
- Pattern segments:
  - plain text matches exactly that segment;
  - `:name` matches any one segment and puts it in `params.name`, URL-decoded (`a%20b` → `a b`);
  - `*name` may only be the last segment; it matches the rest of the path, **including nothing at
    all**, and puts it in `params.name` (segments joined with `/`, each URL-decoded).
- When several routes match, the most specific wins, comparing segment by segment from the left:
  plain text beats `:param`, and `:param` beats `*wildcard`. When two routes are equally
  specific, the one added first wins. The order routes are added in doesn't matter otherwise.
- The method must match. A route added with method `ANY` matches every method, and a `HEAD`
  request may also use a `GET` route.

Run the tests with `npm test`.
