import { GROUPS } from '../checks/common.mjs';

const W = { high: 18, medium: 9, low: 4, info: 0 };
const PW = { P1: 3, P2: 2, P3: 1 };

export function score(issues, { hasGsc, hasKeywords = false }) {
  const groups = {};
  for (const [id, g] of Object.entries(GROUPS)) {
    const list = issues.filter((i) => i.group === id);
    const noData = (id === 'user-signals' && !hasGsc) || (id === 'query-understanding' && !hasGsc && !hasKeywords);
    let s = 100;
    for (const i of list) {
      const scale = i.total ? 0.5 + 0.5 * Math.min(1, (2 * (i.urls.length || i.metric || 0)) / i.total) : 1;
      s -= W[i.severity] * scale;
    }
    groups[id] = { ...g, id, score: noData ? null : Math.max(0, Math.round(s)), counts: { high: 0, medium: 0, low: 0, info: 0 } };
    for (const i of list) groups[id].counts[i.severity]++;
  }
  const scored = Object.values(groups).filter((g) => g.score !== null);
  const overall = Math.round(scored.reduce((a, g) => a + g.score * PW[g.priority], 0) / scored.reduce((a, g) => a + PW[g.priority], 0));
  for (const i of issues) i.rank = PW[GROUPS[i.group].priority] * ({ high: 3, medium: 2, low: 1, info: 0 }[i.severity]);
  return { overall, groups };
}
