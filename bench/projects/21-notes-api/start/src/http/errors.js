export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = () => new HttpError(404, 'not_found', 'Not found.');
export const forbidden = (message = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', message);
export const unauthorized = (message = 'Sign in first.') => new HttpError(401, 'unauthorized', message);
