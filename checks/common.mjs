export const GROUPS = {
  'crawl-index': { label: 'Crawl & index', priority: 'P1' },
  'duplicates': { label: 'Trùng lặp & canonical', priority: 'P1' },
  'site-quality': { label: 'Chất lượng site', priority: 'P1' },
  'links': { label: 'Liên kết & PageRank', priority: 'P1' },
  'user-signals': { label: 'Tín hiệu người dùng (GSC)', priority: 'P1' },
  'spam': { label: 'Chống spam', priority: 'P1' },
  'topicality': { label: 'Chủ đề & cấu trúc nội dung', priority: 'P2' },
  'query-understanding': { label: 'Ý định & từ khoá (GSC)', priority: 'P2' },
  'entities': { label: 'Thực thể & thương hiệu', priority: 'P2' },
  'page-experience': { label: 'Trải nghiệm trang', priority: 'P2' },
  'ai-readiness': { label: 'Sẵn sàng cho AI (GEO)', priority: 'P2' },
  'authorship': { label: 'Tác giả & độ tươi', priority: 'P3' },
};

// severity: 'high' | 'medium' | 'low'
export function issue(group, id, severity, title, { why = '', fix = '', patents = [], urls = [], total = null, metric = null } = {}) {
  return { group, id, severity, title, why, fix, patents, urls: urls.slice(0, 500), count: urls.length || (metric ?? 0), total, metric };
}

export const isHtml200 = (p) => p.status === 200 && (p.type || '').includes('html') && p.title !== undefined && !p.redirectVariant;
export const isNoindex = (p) => /noindex/.test(p.robotsMeta || '') || /noindex/i.test(p.xRobots || '');
export const isIndexable = (p) => isHtml200(p) && !isNoindex(p) && (!p.canonical || p.canonical === p.finalUrl || p.canonical === p.url);
