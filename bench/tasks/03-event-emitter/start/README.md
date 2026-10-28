# events

A small event emitter and a bus with named channels.

## Emitter (`src/emitter.js`)

- `on(event, fn)` adds a listener and returns a function that removes it again (calling that
  function twice is harmless).
- `once(event, fn)` adds a listener that runs at most once, then removes itself. It also returns a
  function that removes it.
- `off(event, fn)` removes one registration of `fn` (also when it was added with `once`; pass the
  same function you gave to `once`). It returns `true` if something was removed, else `false`.
- `emit(event, ...args)` calls the listeners in the order they were added and returns how many it
  called. It works on a **snapshot**: listeners added or removed while an emit is running take
  effect from the next emit.
- `listenerCount(event)` returns how many listeners an event has.

## Bus (`src/bus.js`)

`createBus().channel('chat')` returns an object with the same five methods (`on`, `once`, `off`,
`emit`, `listenerCount`). Channel `chat`, event `msg` is the emitter event `chat:msg`, so two
channels never see each other's events.

Run the tests with `npm test`.
