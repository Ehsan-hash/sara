// Entry point of the fixture project.
import { greet } from './greet.ts';
import { Counter } from './counter.ts';

export function main(): void {
  const c = new Counter();
  c.add(2);
  console.log(greet('world'), c.value);
}

main();
