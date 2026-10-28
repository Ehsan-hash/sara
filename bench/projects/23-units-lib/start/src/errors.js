export class UnitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnitError';
  }
}
