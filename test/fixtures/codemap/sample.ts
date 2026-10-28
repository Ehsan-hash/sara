// Fixture for the code map extractors (valid TypeScript, typechecked with the tests).
import { readFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import {
  join,
  dirname,
} from 'node:path';

/** A shape. */
export interface Shape {
  area(): number;
}

export type Size = 'small' | 'large';

export declare const Color: { Red: 0; Blue: 1 };

const LIMIT = 10;

export const double = (n: number): number => n * 2;

export async function loadText(path: string): Promise<string> {
  // function fakeInComment() {}
  const s = '{ not a brace';
  return readFileSync(join(dirname(path), s), 'utf8');
}

function helper(): RegExp {
  return /[{]/g;
}

export class Circle implements Shape {
  #secret = 1;
  readonly r: number;
  constructor(r: number) {
    this.r = r;
  }

  area(): number {
    return Math.PI * this.r * this.r * LIMIT;
  }

  static unit(): Circle {
    return new Circle(1);
  }

  private hidden(): void {
    if (this.#secret) helper();
  }
}

export default Circle;
export type { Stats };
