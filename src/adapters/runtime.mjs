import { TorchError } from '../kernel/errors.mjs';

export const RUNTIME_OPERATIONS = Object.freeze([
  'detect', 'configure', 'createSession', 'resumeSession', 'sendOrSteer',
  'getStatus', 'listSessions', 'stopSession', 'captureRuntimeId',
  'installHooks', 'removeHooks',
]);

export function validateRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !adapter.capabilities) {
    throw new TorchError('Runtime adapter is missing its name or capability declaration', {
      code: 'INVALID_RUNTIME_ADAPTER',
    });
  }
  for (const operation of RUNTIME_OPERATIONS) {
    if (!(operation in adapter.capabilities)) {
      throw new TorchError(`Runtime adapter ${adapter.name} does not declare ${operation}`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { operation },
      });
    }
    if (typeof adapter[operation] !== 'function') {
      throw new TorchError(`Runtime adapter ${adapter.name} does not implement ${operation}`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { operation },
      });
    }
  }
  return adapter;
}

export function unsupportedCapability(adapterName, operation) {
  throw new TorchError(`${adapterName} adapter does not support ${operation}`, {
    code: 'RUNTIME_CAPABILITY_UNSUPPORTED', details: { adapter: adapterName, operation },
  });
}
