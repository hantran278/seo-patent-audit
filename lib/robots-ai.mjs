// robots.txt as each search / AI crawler reads it: groups of User-agent lines, the most specific matching
// group wins (RFC 9309), longest matching rule wins inside it, Allow wins ties.

// purpose: 'search' = fetches pages to show/cite them in answers; 'training' = collects data for model training
// (blocking it is a policy choice and does not remove you from AI answers); 'user' = fetches on a user's request.
export const AI_BOTS = [
  { token: 'Googlebot', engine: 'Google Search, AI Overviews', purpose: 'search' },
  { token: 'Google-Extended', engine: 'Gemini (training, grounding)', purpose: 'training' },
  { token: 'Bingbot', engine: 'Bing, Copilot', purpose: 'search' },
  { token: 'OAI-SearchBot', engine: 'ChatGPT Search', purpose: 'search' },
  { token: 'ChatGPT-User', engine: 'ChatGPT (user request)', purpose: 'user' },
  { token: 'GPTBot', engine: 'OpenAI (training)', purpose: 'training' },
  { token: 'Claude-SearchBot', engine: 'Claude search', purpose: 'search' },
  { token: 'Claude-User', engine: 'Claude (user request)', purpose: 'user' },
  { token: 'ClaudeBot', engine: 'Anthropic (training)', purpose: 'training' },
  { token: 'PerplexityBot', engine: 'Perplexity', purpose: 'search' },
  { token: 'Perplexity-User', engine: 'Perplexity (user request)', purpose: 'user' },
  { token: 'Applebot-Extended', engine: 'Apple Intelligence (training)', purpose: 'training' },
  { token: 'Bytespider', engine: 'ByteDance / Doubao', purpose: 'training' },
  { token: 'CCBot', engine: 'Common Crawl (training data)', purpose: 'training' },
];

export function parseGroups(txt) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), v = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: v });
    }
  }
  return groups;
}

// Rules for one crawler: every group naming it (case-insensitive product token), else the '*' groups.
function rulesFor(groups, token) {
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && a === t));
  return (named.length ? named : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

export function allowedFor(groups, token, path = '/') {
  let best = null;
  for (const r of rulesFor(groups, token)) {
    if (!r.path) continue; // "Disallow:" with no value allows everything
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// One row per crawler: can it fetch the homepage and the sampled key pages?
export function aiRobotsMatrix(robotsTxt, paths = ['/']) {
  const groups = parseGroups(robotsTxt);
  return AI_BOTS.map((b) => {
    const blocked = paths.filter((p) => !allowedFor(groups, b.token, p));
    const named = groups.some((g) => g.agents.includes(b.token.toLowerCase()));
    return { ...b, named, home: allowedFor(groups, b.token, '/'), blocked };
  });
}
