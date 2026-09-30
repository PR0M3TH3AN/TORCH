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
  for (const capability of ['modelSelection', 'reasoningSelection']) {
    if (typeof adapter.capabilities[capability] !== 'boolean') {
      throw new TorchError(`Runtime adapter ${adapter.name} must declare ${capability} as true or false`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { capability },
      });
    }
  }
  const costCeiling = adapter.capabilities.perInvocationCostCeiling;
  if (!costCeiling || typeof costCeiling !== 'object' || Array.isArray(costCeiling)) {
    throw new TorchError(`Runtime adapter ${adapter.name} must declare perInvocationCostCeiling modes`, {
      code: 'INVALID_RUNTIME_ADAPTER', details: { capability: 'perInvocationCostCeiling' },
    });
  }
  for (const operation of ['createSession', 'resumeSession']) {
    const modes = costCeiling[operation];
    if (!Array.isArray(modes) || modes.some((mode) => typeof mode !== 'string'
      || !/^[a-z][a-z0-9._:-]*$/.test(mode)) || new Set(modes).size !== modes.length) {
      throw new TorchError(`Runtime adapter ${adapter.name} must declare valid cost-ceiling modes for ${operation}`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { capability: 'perInvocationCostCeiling', operation },
      });
    }
  }
  if (adapter.capabilities.modelRequired !== undefined
    && typeof adapter.capabilities.modelRequired !== 'boolean') {
    throw new TorchError(`Runtime adapter ${adapter.name} must declare modelRequired as a boolean`, {
      code: 'INVALID_RUNTIME_ADAPTER', details: { capability: 'modelRequired' },
    });
  }
  if (adapter.capabilities.launchPolicy !== undefined) {
    const declaration = adapter.capabilities.launchPolicy;
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)
      || !declaration.fields || typeof declaration.fields !== 'object' || Array.isArray(declaration.fields)) {
      throw new TorchError(`Runtime adapter ${adapter.name} must declare launchPolicy.fields`, {
        code: 'INVALID_RUNTIME_ADAPTER', details: { capability: 'launchPolicy' },
      });
    }
    for (const [field, values] of Object.entries(declaration.fields)) {
      if (!field || !Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) {
        throw new TorchError(`Runtime adapter ${adapter.name} has an invalid launch-policy declaration`, {
          code: 'INVALID_RUNTIME_ADAPTER', details: { capability: 'launchPolicy', field },
        });
      }
    }
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

export function costCeilingPlanIssues(adapter, operation, maxUsd, runtimePlan) {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    return [{ code: 'RUNTIME_COST_CEILING_INVALID', operation, maxUsd }];
  }
  const modes = adapter.capabilities.perInvocationCostCeiling?.[operation];
  if (!Array.isArray(modes) || modes.length === 0) {
    return [{ code: 'RUNTIME_COST_CEILING_UNSUPPORTED', adapter: adapter.name, operation, maxUsd }];
  }
  const receipt = runtimePlan?.costCeiling;
  if (receipt?.enforced !== true || receipt.maxUsd !== maxUsd
    || typeof receipt.mode !== 'string' || !modes.includes(receipt.mode)) {
    return [{
      code: 'RUNTIME_COST_CEILING_UNPROVEN', adapter: adapter.name, operation, maxUsd,
      declaredModes: modes, receipt: receipt ?? null,
    }];
  }
  return [];
}

export function unsupportedCapability(adapterName, operation) {
  throw new TorchError(`${adapterName} adapter does not support ${operation}`, {
    code: 'RUNTIME_CAPABILITY_UNSUPPORTED', details: { adapter: adapterName, operation },
  });
}

export function resolveLaunchPolicy({ runtime, adapterDefaults = {}, runtimeConfig = {}, identity = {} } = {}) {
  const hasLegacyPolicy = runtime === 'codex'
    && (Object.hasOwn(runtimeConfig, 'sandbox') || Object.hasOwn(runtimeConfig, 'approval'));
  const legacyPolicy = hasLegacyPolicy ? {
    ...(runtimeConfig.sandbox === undefined ? {} : { sandbox: runtimeConfig.sandbox }),
    ...(runtimeConfig.approval === undefined ? {} : { approval: runtimeConfig.approval }),
  } : {};
  // The historical generated pair described the same effective Codex mode as
  // --approve-for-me (which implies workspace-write); do not emit both flags.
  if (legacyPolicy.sandbox === 'workspace-write' && legacyPolicy.approval === 'approve-for-me') {
    delete legacyPolicy.sandbox;
  }
  const nestedPolicy = runtimeConfig.launchPolicy ?? {};
  const launchPolicy = {
    ...(adapterDefaults.launchPolicy ?? {}),
    ...(Object.keys(nestedPolicy).length ? nestedPolicy : legacyPolicy),
    ...(identity.launchPolicy ?? {}),
  };
  if (Object.keys(nestedPolicy).length && hasLegacyPolicy) launchPolicy._legacyFieldsConflict = 'true';
  return launchPolicy;
}

export function profileCapabilityIssues(adapter, { model, reasoning, launchPolicy = {} } = {}) {
  const issues = [];
  if (adapter.capabilities.modelRequired === true && !model) {
    issues.push({ field: 'model', capability: 'modelSelection', required: true });
  }
  if (model && adapter.capabilities.modelSelection !== true) {
    issues.push({ field: 'model', capability: 'modelSelection' });
  }
  if (reasoning && adapter.capabilities.reasoningSelection !== true) {
    issues.push({ field: 'reasoning', capability: 'reasoningSelection' });
  }
  if (launchPolicy && (typeof launchPolicy !== 'object' || Array.isArray(launchPolicy))) {
    issues.push({ field: 'launchPolicy', capability: 'launchPolicy', reason: 'must be an object' });
    return issues;
  }
  const declaration = adapter.capabilities.launchPolicy;
  for (const [field, value] of Object.entries(launchPolicy ?? {})) {
    const allowed = declaration?.fields?.[field];
    if (!allowed) {
      issues.push({ field: `launchPolicy.${field}`, capability: 'launchPolicy', value });
    } else if (typeof value !== 'string' || !allowed.includes(value)) {
      issues.push({ field: `launchPolicy.${field}`, capability: 'launchPolicy', value, allowed });
    }
  }
  for (const conflict of declaration?.conflicts ?? []) {
    if (launchPolicy?.[conflict.field] === conflict.value && Object.hasOwn(launchPolicy ?? {}, conflict.with)) {
      issues.push({
        field: `launchPolicy.${conflict.field}`, capability: 'launchPolicy', value: conflict.value,
        conflictsWith: `launchPolicy.${conflict.with}`,
      });
    }
  }
  return issues;
}
