(function (global) {
  function prepareOwnerDecisionShortcut(form, decision, beginPreview) {
    if (!['approved', 'rejected'].includes(decision)) {
      return { started: false, reason: 'Choose approve or reject from an owner-only shortcut.' };
    }
    const choice = form?.elements?.namedItem('decision');
    if (!form || !choice) {
      return { started: false, reason: 'This owner decision form is no longer available. Refresh the current evidence before acting.' };
    }
    if (form.dataset.previewToken || choice.disabled) {
      return { started: false, reason: 'An existing decision preview is preserved. Review or edit it in Flow watch before using another shortcut.' };
    }
    if (choice.value && choice.value !== decision) {
      return { started: false, reason: 'Your existing decision draft is preserved. Review or change it in Flow watch before choosing another shortcut.' };
    }
    if (typeof beginPreview !== 'function') {
      return { started: false, reason: 'The guarded decision preview is unavailable. Refresh before acting.' };
    }
    choice.value = decision;
    beginPreview?.(form);
    return { started: true };
  }

  global.TorchAttentionActions = Object.freeze({ prepareOwnerDecisionShortcut });
})(globalThis);
