import { Emitter } from './emitter.js';

/** A bus with channels: bus.channel('chat').on('msg', fn) listens to 'chat:msg'. */
export function createBus() {
  const emitter = new Emitter();
  return {
    emitter,
    channel(name) {
      return {
        on: (event, fn) => emitter.on(`${name}:${event}`, fn),
        emit: (event, ...args) => emitter.emit(`${name}:${event}`, ...args),
      };
    },
  };
}
