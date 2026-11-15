export function periodicVariables(kind: 'daily' | 'weekly' | 'monthly', date: string) {
  const actual = new Date(`${date}T12:00:00Z`);
  const thursday = new Date(actual);
  thursday.setUTCDate(actual.getUTCDate() + 4 - (actual.getUTCDay() || 7));
  const weekYear = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(weekYear, 0, 1)) / 86400_000 + 1) / 7);
  return {
    date,
    year: String(kind === 'weekly' ? weekYear : actual.getUTCFullYear()),
    month: date.slice(5, 7),
    day: date.slice(8, 10),
    week: String(week).padStart(2, '0'),
    title:
      kind === 'daily'
        ? date
        : kind === 'weekly'
          ? `${weekYear}-W${String(week).padStart(2, '0')}`
          : date.slice(0, 7),
  };
}

export function renderPeriodic(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (whole: string, key: string) => variables[key] ?? whole);
}

export function dailyNotePath(directory: string, pattern: string, date: string): string {
  if (!directory) return '';
  const rendered = renderPeriodic(pattern, periodicVariables('daily', date)).replace(/\\/g, '/');
  // Invalid patterns are rejected on creation and must not identify an unrelated note here.
  if (/^(?:\/|[a-z]:)/i.test(rendered) || rendered.split('/').includes('..')) return '';
  return `${directory.replace(/\\/g, '/').replace(/\/$/, '')}/${rendered.replace(/^\.\//, '')}`.toLowerCase();
}
