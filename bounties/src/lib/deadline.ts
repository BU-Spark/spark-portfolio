export function daysUntil(deadline: string): number | null {
  const d = new Date(deadline + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function deadlineLabel(deadline: string): { text: string; cls: string } {
  const days = daysUntil(deadline);
  if (days === null) return { text: deadline, cls: 'text-spark-eggshell/60' };
  if (days < 0) return { text: 'Closed', cls: 'text-gray-400' };
  if (days === 0) return { text: 'Due today!', cls: 'text-red-400 font-semibold' };
  if (days <= 3) return { text: `${days}d left`, cls: 'text-red-400 font-semibold' };
  if (days <= 7) return { text: `${days}d left`, cls: 'text-orange-400 font-semibold' };
  if (days <= 30) return { text: `${days}d left`, cls: 'text-yellow-400' };
  return { text: `${days}d left`, cls: 'text-spark-eggshell/60' };
}

/** "Sep 22" — short month + day, no year. */
export function shortDate(deadline: string): string {
  const d = new Date(deadline + 'T00:00:00');
  if (isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Framework-free deadline copy for the redesign: far-out dates read as
 * "Due Sep 22", anything inside a week reads as urgent countdown.
 * Callers style with the `urgent` flag rather than a class name.
 */
export function dueLabel(deadline: string): { text: string; urgent: boolean } {
  const days = daysUntil(deadline);
  if (days === null) return { text: deadline, urgent: false };
  if (days < 0) return { text: 'Closed', urgent: false };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: '1 day left', urgent: true };
  if (days <= 7) return { text: `${days} days left`, urgent: true };
  return { text: `Due ${shortDate(deadline)}`, urgent: false };
}

/**
 * "Aug 15 — 5 days left" for the detail sidebar. Computes the countdown from
 * `days` directly; deriving it from dueLabel's text yields "Dec 31 — Dec 31"
 * for far-out dates, where that label is already just the date.
 */
export function deadlineDetail(deadline: string): { text: string; urgent: boolean } {
  const days = daysUntil(deadline);
  if (days === null) return { text: deadline, urgent: false };
  const date = shortDate(deadline);
  if (days < 0) return { text: `${date} — closed`, urgent: false };
  if (days === 0) return { text: `${date} — due today`, urgent: true };
  return { text: `${date} — ${days} day${days === 1 ? '' : 's'} left`, urgent: days <= 7 };
}

/** Derive effective status: if deadline has passed and status is 'open', treat as 'closed'. */
export function effectiveStatus(status: string, deadline: string): string {
  if (status === 'open') {
    const days = daysUntil(deadline);
    if (days !== null && days < 0) return 'closed';
  }
  return status;
}
