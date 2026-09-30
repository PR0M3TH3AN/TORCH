(function installTorchWorkProgress(root) {
  function summarize(tasks, field) {
    const groups = new Map();
    for (const task of tasks ?? []) {
      const name = typeof task[field] === 'string' ? task[field].trim() : '';
      if (!name) continue;
      const group = groups.get(name) ?? { name, tasks: [] };
      group.tasks.push({ id: task.id, title: task.title ?? task.id, state: task.state, owner: task.owner ?? null });
      groups.set(name, group);
    }
    return [...groups.values()].map((group) => {
      const counts = { completed: 0, cancelled: 0, blocked: 0, working: 0, review: 0, queued: 0, other: 0 };
      for (const task of group.tasks) {
        if (task.state === 'completed') counts.completed += 1;
        else if (task.state === 'cancelled') counts.cancelled += 1;
        else if (task.state === 'blocked') counts.blocked += 1;
        else if (['assigned', 'in_progress'].includes(task.state)) counts.working += 1;
        else if (['verification', 'ready_to_integrate'].includes(task.state)) counts.review += 1;
        else if (['proposed', 'ready'].includes(task.state)) counts.queued += 1;
        else counts.other += 1;
      }
      const active = group.tasks.length - counts.cancelled;
      const outstanding = active - counts.completed;
      const progress = active ? Math.round((counts.completed / active) * 100) : 0;
      const status = outstanding === 0
        ? (counts.completed ? 'Complete' : 'Cancelled')
        : counts.blocked ? 'At risk'
          : counts.queued === outstanding ? 'Queued'
            : counts.review > 0 && counts.working === 0 && counts.queued === 0 ? 'In review'
              : 'In progress';
      return { ...group, counts, active, progress, status };
    }).sort((left, right) => left.name.localeCompare(right.name));
  }

  function summarizeInitiatives(tasks = []) {
    return { features: summarize(tasks, 'feature'), milestones: summarize(tasks, 'milestone') };
  }

  root.TorchWorkProgress = Object.freeze({ summarizeInitiatives });
}(globalThis));
