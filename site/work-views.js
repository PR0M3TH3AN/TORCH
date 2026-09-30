(function installTorchWorkViews(root) {
  const SCHEMA = 'torch.dev/console-saved-views/v1alpha1';
  const MAX_VIEWS = 20;
  const MAX_NAME = 64;
  const MAX_QUERY = 120;
  const FILTER_KEYS = ['query', 'owner', 'state', 'priority', 'domain', 'feature', 'milestone'];

  function emptyFilters() {
    return { query: '', owner: '', state: '', priority: '', domain: '', feature: '', milestone: '' };
  }

  function normalizeFilters(filters = {}) {
    const normalized = emptyFilters();
    for (const key of FILTER_KEYS) {
      if (typeof filters[key] !== 'string') continue;
      const limit = key === 'query' ? MAX_QUERY : 100;
      normalized[key] = filters[key].trim().slice(0, limit);
    }
    return normalized;
  }

  function hasFilters(filters = {}) {
    const normalized = normalizeFilters(filters);
    return FILTER_KEYS.some((key) => normalized[key] !== '');
  }

  function filterTasks(tasks = [], filters = {}) {
    const selected = normalizeFilters(filters);
    const query = selected.query.toLocaleLowerCase();
    return tasks.filter((task) => {
      if (['completed', 'cancelled'].includes(task.state)) return false;
      if (selected.owner && (task.owner ?? 'Unassigned') !== selected.owner) return false;
      if (selected.state && task.state !== selected.state) return false;
      if (selected.priority && (task.priority ?? 'normal') !== selected.priority) return false;
      if (selected.domain && !(task.affectedDomains ?? []).includes(selected.domain)) return false;
      if (selected.feature && task.feature !== selected.feature) return false;
      if (selected.milestone && task.milestone !== selected.milestone) return false;
      if (!query) return true;
      const haystack = [
        task.id, task.title, task.description, task.owner, task.state, task.priority,
        task.feature, task.milestone,
        ...(task.affectedDomains ?? []), ...(task.dependencies ?? []),
      ].filter(Boolean).join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  function storageKey(projectIdentity) {
    const identity = String(projectIdentity ?? '').trim();
    if (!identity) throw new Error('Saved views require a project identity.');
    return `torch.console.saved-views:${encodeURIComponent(identity)}`;
  }

  function normalizeRecord(record) {
    if (!record || typeof record.id !== 'string' || !record.id || typeof record.name !== 'string') return null;
    const name = record.name.trim().slice(0, MAX_NAME);
    if (!name) return null;
    return {
      id: record.id.slice(0, 96), name,
      filters: normalizeFilters(record.filters),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    };
  }

  function validRecord(record) {
    if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 96
      || typeof record.name !== 'string' || !record.name.trim() || record.name.trim().length > MAX_NAME
      || !record.filters || typeof record.filters !== 'object' || Array.isArray(record.filters)) return false;
    if (record.updatedAt !== undefined && record.updatedAt !== null && typeof record.updatedAt !== 'string') return false;
    return FILTER_KEYS.every((key) => record.filters[key] === undefined
      || (typeof record.filters[key] === 'string' && record.filters[key].length <= (key === 'query' ? MAX_QUERY : 100)));
  }

  function readSavedViews(storage, key) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return { views: [], warning: null };
      const parsed = JSON.parse(raw);
      if (parsed?.schema !== SCHEMA || !Array.isArray(parsed.views) || parsed.views.length > MAX_VIEWS) {
        return { views: [], warning: 'Saved views have an unsupported format; start a new set for this project.' };
      }
      const ids = new Set();
      const views = [];
      for (const record of parsed.views) {
        if (!validRecord(record) || ids.has(record.id)) {
          return { views: [], warning: 'Saved views contain invalid data; the unfiltered backlog is shown.' };
        }
        ids.add(record.id);
        views.push(normalizeRecord(record));
      }
      return { views, warning: null };
    } catch {
      return { views: [], warning: 'Saved views are unavailable in this browser; the backlog remains unchanged.' };
    }
  }

  function persist(storage, key, views) {
    try {
      storage.setItem(key, JSON.stringify({ schema: SCHEMA, views: views.slice(0, MAX_VIEWS) }));
      return { ok: true };
    } catch {
      return { ok: false, message: 'This browser could not save the view. Your project backlog was not changed.' };
    }
  }

  function makeId() {
    return root.crypto?.randomUUID?.()
      ?? `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function saveView({ storage, key, views = [], id = null, name, filters, now = () => new Date() } = {}) {
    const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
    if (!cleanName) return { ok: false, code: 'VIEW_NAME_REQUIRED', message: 'Enter a name for this view.' };
    const duplicate = views.find((view) => view.id !== id && view.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (duplicate) return { ok: false, code: 'VIEW_NAME_EXISTS', message: 'A saved view already uses that name.' };
    if (!id && views.length >= MAX_VIEWS) {
      return { ok: false, code: 'VIEW_LIMIT_REACHED', message: `You can save up to ${MAX_VIEWS} views per project.` };
    }
    if (id && !views.some((view) => view.id === id)) {
      return { ok: false, code: 'VIEW_NOT_FOUND', message: 'That saved view is no longer available.' };
    }
    const view = {
      id: id ?? makeId(), name: cleanName,
      filters: normalizeFilters(filters), updatedAt: now().toISOString(),
    };
    const next = id ? views.map((existing) => existing.id === id ? view : existing) : [...views, view];
    const written = persist(storage, key, next);
    return written.ok ? { ok: true, view, views: next } : { ...written, code: 'VIEW_STORAGE_UNAVAILABLE' };
  }

  function deleteView({ storage, key, views = [], id } = {}) {
    if (!views.some((view) => view.id === id)) {
      return { ok: false, code: 'VIEW_NOT_FOUND', message: 'That saved view is no longer available.' };
    }
    const next = views.filter((view) => view.id !== id);
    const written = persist(storage, key, next);
    return written.ok ? { ok: true, views: next } : { ...written, code: 'VIEW_STORAGE_UNAVAILABLE' };
  }

  root.TorchWorkViews = Object.freeze({
    schema: SCHEMA, maxViews: MAX_VIEWS, emptyFilters, normalizeFilters,
    hasFilters, filterTasks, storageKey, readSavedViews, saveView, deleteView,
  });
}(globalThis));
