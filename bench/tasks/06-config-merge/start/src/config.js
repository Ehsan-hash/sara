import { fromEnv } from './env.js';
import { merge } from './merge.js';

export function loadConfig(defaults, file = {}, env = {}, prefix = 'APP') {
  return merge(merge(defaults, file), fromEnv(env, prefix));
}
