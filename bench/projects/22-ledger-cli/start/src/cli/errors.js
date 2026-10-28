/** An error the user caused; printed as "error: …" with an exit code (2 = usage). */
export class UsageError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.exitCode = code;
  }
}

/** Bad data (an amount or date that can't be read): exit code 1. */
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 1;
  }
}
