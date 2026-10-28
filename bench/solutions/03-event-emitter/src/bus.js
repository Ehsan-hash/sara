import { Emitter } from './emitter.js';

/** A bus with channels: bus.channel('chat').on('msg', fn) listens to 'chat:msg'. */
export function createBus() {
  const emitter = new Emitter();
  return {
    emitter,
    channel(name) {
      const key = (event) => `${name}:${event}`;
      return {
        on: (event, fn) => emitter.on(key(event), fn),
        once: (event, fn) => emitter.once(key(event), fn),
        off: (event, fn) => emitter.off(key(event), fn),
        emit: (event, ...args) => emitter.emit(key(event), ...args),
        listenerCount: (event) => emitter.listenerCount(key(event)),
      };
    },
  };
}
