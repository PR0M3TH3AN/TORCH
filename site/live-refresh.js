(() => {
  function createScheduler({ load, apply, onError = () => {} }) {
    let generation = 0;
    let running = null;
    function request({ supersede = true } = {}) {
      if (running && !supersede) return running;
      generation += 1;
      if (running) return running;
      running = (async () => {
        let observed;
        do {
          observed = generation;
          try {
            const snapshot = await load();
            if (observed === generation) apply(snapshot);
          } catch (error) { if (observed === generation) onError(error); }
        } while (observed !== generation);
      })().finally(() => { running = null; });
      return running;
    }
    return Object.freeze({ request });
  }
  function createProtection(document) {
    const baseline = new WeakMap();
    const fields = (element) => [...element.querySelectorAll('input,select,textarea')];
    const signature = (field) => JSON.stringify({ value: field.value, checked: field.checked,
      selected: field.tagName === 'SELECT' ? [...field.selectedOptions].map((option) => option.value) : null });
    const dirty = () => new Set(fields(document).filter((field) => baseline.has(field) && baseline.get(field) !== signature(field)));
    const remember = ({ preserve = new Set() } = {}) => fields(document).forEach((field) => {
      if (!preserve.has(field)) baseline.set(field, signature(field));
    });
    function protects(element) {
      if (!element) return false;
      const focused = document.activeElement;
      if (element.contains(focused) && focused?.matches('input,select,textarea,button,a,summary')) return true;
      if (element.matches('[data-preview-token]') || element.querySelector('[data-preview-token]')) return true;
      return fields(element).some((field) => baseline.has(field) && baseline.get(field) !== signature(field));
    }
    function complete(element) {
      if (!element) return;
      fields(element).forEach((field) => baseline.set(field, signature(field)));
      [element, ...element.querySelectorAll('[data-preview-token]')].forEach((node) => {
        delete node.dataset.previewToken;
        delete node.dataset.planHash;
      });
      if (element.contains(document.activeElement)) document.activeElement.blur();
    }
    return Object.freeze({ remember, dirty, protects, complete });
  }
  globalThis.TorchLiveRefresh = Object.freeze({ createScheduler, createProtection });
})();
