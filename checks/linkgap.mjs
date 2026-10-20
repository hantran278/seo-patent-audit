// Link gap that a team can act on: domains linking to competitors but not to us, minus the ones nobody can get a
// link from by outreach (search engines, social/UGC platforms, big vendors, job boards, the competitor's own network),
// then grouped by the kind of opportunity and ranked by how many competitors they already link to.

// search engines, social / UGC / self-publishing platforms, hosting, file sharing and URL shorteners
const PLATFORM = /(^|\.)(google|youtube|facebook|instagram|twitter|x|linkedin|pinterest|reddit|quora|tiktok|vk|ok|telegram|t|telegra|discord|whatsapp|yahoo|bing|msn|yandex|ya|baidu|naver|duckduckgo|ecosia|wikipedia|wikimedia|wikidata|wikiwand|grokipedia|everybodywiki|medium|substack|beehiiv|ghost|steemit|vocal|hubpages|tumblr|blogspot|blogger|wordpress|wpcomstaging|home|livedoor|brunch|velog|zenn|habr|vc|dev|hashnode|plainenglish|gitconnected|towardsdatascience|csdn|cnblogs|github|gitlab|codeberg|bitbucket|stackoverflow|stackexchange|slideshare|speakerdeck|scribd|issuu|flipsnack|flippingbook|pressbooks|gitbook|notion|archive|soundcloud|spotify|castbox|podchaser|poddtoppen|spreaker|buzzsprout|vimeo|dailymotion|myspace|about|linktr|bit|is|tinyurl|shorturl|goo|ow|buff|amazonaws|googleapis|cloudfront|azureedge|akamaized|herokuapp|netlify|vercel|hostingersite|lovable|atlassian|scoop|raindrop|bibsonomy|alternativeto|producthunt|apple|microsoft|amazon|samsung|adobe|intel|asus|salesforce|hubspot|intuit|verizon|shopify|alibaba|alibabacloud|oracle|ibm|sap|cisco|dell|hp|zoom)\.[a-z.]{2,6}$/;
// job boards, salary and freelance marketplaces: links from them follow hiring, not outreach
const JOBS = /(^|\.)(indeed|glassdoor|ziprecruiter|monster|dice|naukri|internshala|hh|superjob|work|robota|rocketjobs|justjoin|nofluffjobs|jobbkk|wuzzuf|jobillico|jobstreet|careerbuilder|levels|teamblind|comparably|fairygodboss|careerguide|careerkarma|wellfound|freelancermap|freelancehunt|freelancer|upwork|workana|fiverr|layboard|4dayweek|recruitee|joinhandshake|join)\.[a-z.]{2,6}$/;
// company-data aggregators that build profiles by scraping: nothing to ask for
const DATA_SCRAPER = /zoominfo|rocketreach|leadiq|seamless\.ai|contactout|datanyze|growjo|apollo\.io|lusha|signalhire|leadgenius|iplocation|websitedata|siteindices|companieshistory|rusprofile|opencorporates/;
// where an IT services / agency firm gets listed or reviewed: the most reachable gap
const B2B_DIRECTORY = /clutch|goodfirms|designrush|themanifest|sortlist|upcity|techreviewer|techbehemoths|topdevelopers|softwareworld|itfirms|appfutura|selectedfirms|superbcompanies|topsoftwarecompanies|appdevelopmentcompanies|ineedanagency|pickanagency|agencyspotter|digitalagencynetwork|outsourceaccelerator|g2\.|capterra|softwareadvice|getapp|trustradius|softwaresuggest|provenexpert|clearlyrated|trustpilot|bbb\.org|crunchbase|builtin|f6s|europages|yellowpages|yell\.com|yelp|thomasnet|theorg|cbinsights|pitchbook|tracxn|dnb\.com|featuredcustomers|casestudies|awwwards|cssdesignawards|behance|dribbble/;
const MEDIA = /news|times|post\.|daily|journal|magazine|mag\.|wire|press|herald|tribune|gazette|insider|report|today|week|forbes|reuters|fortune|economist|entrepreneur|inc\.com|wired|techcrunch|thenextweb|venturebeat|zdnet|cnet|techradar|techrepublic|computerworld|computerweekly|informationweek|cio\.com|eweek|eetimes|infoq|dzone|thenewstack|yourstory|benzinga|businesswire|prnewswire|einpresswire|newswire|ceoworld|bmmagazine|londonlovesbusiness|finextra|retaildive|marketingdive|techbullion|coruzant|analyticsinsight|aijourn|aimagazine|bbntimes/;
const EDU = /\.edu(\.[a-z]{2})?$|\.ac\.[a-z]{2}$|(^|\.)edu\.[a-z]{2}$|\.gov(\.[a-z]{2})?$|\.mil$|(^|\.)gov\.[a-z]{2}$|ieee\.org|acm\.org|springer|mdpi|sagepub|emerald|liebertpub|cell\.com/;

export const GAP_KINDS = ['Danh bạ / đánh giá B2B', 'Báo chí / PR', 'Giáo dục / tổ chức', 'Blog / site khác'];
export const kindOf = (d) => (B2B_DIRECTORY.test(d) ? GAP_KINDS[0] : MEDIA.test(d) ? GAP_KINDS[1] : EDU.test(d) ? GAP_KINDS[2] : GAP_KINDS[3]);

// competitors: [[host, [{domain, as, links}]]]; ownSet: domains already linking to us; skip(d): spam / stats sites.
// Returns per competitor { host, total, excluded: {reason: n}, gap: [...] } and the cross-competitor intersect list.
export function linkGap(competitors, ownSet, { skip = () => false, maxList = 300 } = {}) {
  const labels = competitors.map(([host]) => host.split('.')[0].replace(/[^a-z0-9]/g, '')).filter((l) => l.length >= 4);
  const network = (d) => labels.some((l) => d.replace(/[^a-z0-9.]/g, '').includes(l));
  const reason = (x) => (skip(x.domain) ? 'spam / site thống kê' : network(x.domain) ? 'site vệ tinh của đối thủ' : PLATFORM.test(x.domain) ? 'nền tảng lớn / mạng xã hội / UGC' : JOBS.test(x.domain) ? 'tuyển dụng / freelance' : DATA_SCRAPER.test(x.domain) ? 'site dữ liệu doanh nghiệp tự sinh' : x.as !== null && x.as >= 90 && !MEDIA.test(x.domain) && !EDU.test(x.domain) ? 'nền tảng lớn / mạng xã hội / UGC' : x.as !== null && x.as < 10 ? 'AS/DR < 10' : null);
  // how many competitors each candidate links to
  const shared = new Map();
  for (const [, ds] of competitors) for (const d of ds) if (!ownSet.has(d.domain)) shared.set(d.domain, (shared.get(d.domain) || 0) + 1);
  const rank = (a, b) => GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind) || b.shared - a.shared || (b.as ?? 0) - (a.as ?? 0);
  const all = new Map();
  const gaps = competitors.map(([host, ds]) => {
    const excluded = {};
    const gap = [];
    for (const d of ds) {
      if (ownSet.has(d.domain)) continue;
      const why = reason(d);
      if (why) { excluded[why] = (excluded[why] || 0) + 1; continue; }
      const x = { domain: d.domain, as: d.as, links: d.links, kind: kindOf(d.domain), shared: shared.get(d.domain) || 1 };
      gap.push(x);
      const y = all.get(d.domain) || { ...x, competitors: [] };
      if (d.as !== null) y.as = Math.max(y.as ?? 0, d.as);
      y.competitors.push(host);
      all.set(d.domain, y);
    }
    gap.sort(rank);
    return { host, total: ds.length, kept: gap.length, excluded, byKind: Object.fromEntries(GAP_KINDS.map((k) => [k, gap.filter((x) => x.kind === k).length])), gap: gap.slice(0, maxList) };
  });
  const intersect = [...all.values()].filter((x) => x.competitors.length >= 2).sort(rank).slice(0, maxList);
  return { gaps, intersect };
}
