const MAX_REPORT_BYTES = 65_536;

function inspectReport(policy, report, subject) {
  if (!report || report.schema !== 'torch.dev/check-conditions/v1alpha1'
    || report.subject?.commit !== subject.commit
    || (subject.inputDigest && report.subject?.inputDigest !== subject.inputDigest)
    || !report.conditions || Array.isArray(report.conditions) || typeof report.conditions !== 'object') {
    return 'condition-subject-or-report-invalid';
  }
  if (Object.hasOwn(report, 'runtimeId')
    && (typeof report.runtimeId !== 'string' || !report.runtimeId.trim() || report.runtimeId.length > 256)) {
    return 'condition-runtime-identity-invalid';
  }
  for (const requirement of policy.required) {
    if (!Object.hasOwn(report.conditions, requirement.id)) return `condition-missing:${requirement.id}`;
    if (report.conditions[requirement.id] !== requirement.equals) return `condition-mismatch:${requirement.id}`;
  }
  return null;
}

function probe({ definition, subject, cwd, executor, clock }) {
  const policy = definition.conditions;
  const startedAt = clock().toISOString();
  let result;
  try {
    result = executor(policy.command, policy.args ?? [], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (policy.timeout_seconds ?? 30) * 1000, maxBuffer: MAX_REPORT_BYTES,
      env: { ...process.env, TORCH_CHECK_COMMIT: subject.commit, TORCH_CHECK_INPUT_DIGEST: subject.inputDigest ?? '' },
    });
  } catch (error) {
    return { valid: false, reason: 'condition-probe-executor-failed', startedAt,
      finishedAt: clock().toISOString(), error: error.message, report: null };
  }
  result ??= { status: null };
  const raw = result.stdout?.toString() ?? '';
  let report = null;
  let reason = null;
  if (result.status !== 0 || result.error || result.signal) reason = 'condition-probe-failed';
  else if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) reason = 'condition-report-too-large';
  else {
    try { report = JSON.parse(raw); } catch { reason = 'condition-report-malformed'; }
    if (!reason) reason = inspectReport(policy, report, subject);
  }
  return { valid: !reason, reason, report, startedAt, finishedAt: clock().toISOString(),
    exitStatus: result.status ?? null, signal: result.signal ?? null };
}

/** Project probes report conditions; TORCH validates their contract, not sensor truth.
 * Before/after checks must observe the same test subject in the project harness.
 */
export function validConditionEvidence({ definition, conditions, commit }) {
  if (!definition.conditions) return true;
  if (conditions?.before?.valid !== true || conditions?.after?.valid !== true
    || conditions.subject?.commit !== commit) return false;
  const before = conditions.before.report;
  const after = conditions.after.report;
  return !inspectReport(definition.conditions, before, conditions.subject)
    && !inspectReport(definition.conditions, after, conditions.subject)
    && (before.runtimeId === undefined || after.runtimeId === before.runtimeId);
}

export function executeConditionedCheck({ definition, subject, cwd, executor, clock }) {
  const conditions = definition.conditions ? {
    provenance: 'project-reported', subject,
    required: definition.conditions.required, before: null, after: null,
  } : null;
  let result;
  let invalidReason = null;
  if (conditions) {
    conditions.before = probe({ definition, subject, cwd, executor, clock });
    if (!conditions.before.valid) return {
      result: { status: null, stdout: `TORCH_CHECK_CONDITIONS ${JSON.stringify(conditions.before)}\n`,
        stderr: conditions.before.reason },
      conditions, invalidReason: 'test-conditions-invalid-before', measurementsExecuted: false,
    };
  }
  try {
    result = executor(definition.command, definition.args ?? [], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TORCH_CHECK_COMMIT: subject.commit, TORCH_CHECK_INPUT_DIGEST: subject.inputDigest ?? '' },
    });
    if (result.error || result.signal) invalidReason = 'executor-failed';
  } catch (error) {
    result = { status: null, stdout: '', stderr: error.message };
    invalidReason = 'executor-failed';
  }
  if (conditions) {
    conditions.after = probe({ definition, subject, cwd, executor, clock });
    if (conditions.after.valid && conditions.before.report.runtimeId !== undefined
      && conditions.after.report.runtimeId !== conditions.before.report.runtimeId) {
      conditions.after = { ...conditions.after, valid: false, reason: 'condition-runtime-changed' };
    }
    if (!conditions.after.valid) invalidReason = 'test-conditions-invalid-after';
  }
  // Keep the diagnostic line ahead of measurement output in the retained log.
  if (conditions) result = { ...result, stdout:
    `TORCH_CHECK_CONDITIONS ${JSON.stringify(conditions.before)}\n${result.stdout?.toString() ?? ''}\nTORCH_CHECK_CONDITIONS_AFTER ${JSON.stringify(conditions.after)}\n` };
  return { result, conditions, invalidReason, measurementsExecuted: true };
}
