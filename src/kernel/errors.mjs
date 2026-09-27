export class TorchError extends Error {
  constructor(message, { code = 'TORCH_ERROR', details = undefined } = {}) {
    super(message);
    this.name = 'TorchError';
    this.code = code;
    this.details = details;
  }
}

export function asErrorRecord(error) {
  return {
    error: error?.code ?? 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}
