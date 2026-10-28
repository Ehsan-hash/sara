import { shout } from './util/text.ts';

/** Says hello. */
export function greet(name: string): string {
  return shout(`hello ${name}`);
}
