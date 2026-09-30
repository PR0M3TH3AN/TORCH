import { TorchError } from '../kernel/errors.mjs';

export const DELIVERY_OPERATIONS = Object.freeze(['release', 'deploy', 'verifyLive']);

export function validateDeliveryAdapter(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !adapter.capabilities) {
    throw new TorchError('Delivery adapter is missing its name or capability declaration', {
      code: 'INVALID_DELIVERY_ADAPTER',
    });
  }
  for (const operation of DELIVERY_OPERATIONS) {
    if (!(operation in adapter.capabilities) || typeof adapter[operation] !== 'function') {
      throw new TorchError(`Delivery adapter ${adapter.name} does not declare and implement ${operation}`, {
        code: 'INVALID_DELIVERY_ADAPTER', details: { operation },
      });
    }
    const safety = adapter.retrySafety?.[operation];
    if (safety !== undefined && !['never', 'idempotent', 'read-only'].includes(safety)) {
      throw new TorchError('Invalid delivery retry safety declaration', { code: 'INVALID_DELIVERY_ADAPTER', details: { operation } });
    }
  }
  return adapter;
}

export function unsupportedDeliveryCapability(adapterName, operation) {
  throw new TorchError(`${adapterName} delivery adapter does not support ${operation}`, {
    code: 'DELIVERY_CAPABILITY_UNSUPPORTED', details: { adapter: adapterName, operation },
  });
}
