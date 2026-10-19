// GEO / hygiene checks on a synthetic site built through the real extractor (no network).
import assert from 'node:assert/strict';
import { extract } from '../lib/extract.mjs';
import { geoChecks, geoProbeChecks } from '../checks/geo.mjs';

const HOST = 'ex.com';
const para = (n, word = 'nội dung') => '<p>' + Array.from({ length: n }, () => word).join(' ') + '.</p>';
function page(path, html, extra = {}) {
  const url = `https://${HOST}${path}`;
  return { url, finalUrl: url, status: 200, type: 'text/html', depth: 1, ...extract(html, url), ...extra };
}
const doc = (body, head = '<meta charset="utf-8">', doctype = '<!DOCTYPE html>') => `${doctype}<html lang="vi"><head>${head}<title>T</title></head><body>${body}</body></html>`;

// Good article: ids, list, table, short paragraphs, figures, outbound source, captions, video with schema.
const good = page('/blog/good/', doc(`<main><h1>Chi phí thiết kế website doanh nghiệp</h1>
  <h2 id="a">Giá</h2>${para(60)}<p>Gói cơ bản khoảng 30 triệu đồng, triển khai trong 6 tuần, theo <a href="https://gov.vn/bao-cao">báo cáo</a>.</p>
  <h2 id="b">Quy trình</h2><ol><li>Một</li><li>Hai</li><li>Ba</li></ol><h3 id="c">Chi tiết</h3><table><tr><td>x</td></tr></table>
  ${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}${para(40)}
  <figure><img src="/1.png" alt="Sơ đồ quy trình"><figcaption>Quy trình</figcaption></figure><img src="/2.png" alt="Bảng giá"><img src="/3.png" alt="Đội ngũ">
  <a href="/svc/">dịch vụ thiết kế</a><iframe src="https://www.youtube.com/embed/x"></iframe>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"v"}</script></main>`));

// Weak article: no doctype, no charset, long H1, no heading ids, wall of long paragraphs, no figures, no sources,
// duplicate alts, internal nofollow, anchor reused for two targets, video without schema.
const weak = page('/blog/weak/', doc(`<main><h1>${'Hướng dẫn chi tiết toàn diện '.repeat(4)}</h1>
  <h2>Phần một</h2>${para(200)}<h2>Phần hai</h2>${para(200)}<h3>Phần ba</h3>${para(200)}${para(200)}${para(200)}
  <img src="/x1.png" alt="ảnh minh hoạ"><img src="/x2.png" alt="ảnh minh hoạ"><img src="/x3.png" alt="ảnh khác">
  <a href="/a/" rel="nofollow">trang nội bộ</a><a href="/svc-old/">dịch vụ thiết kế</a>
  <a href="https://facebook.com/sharer/sharer.php?u=x">share</a><video src="/v.mp4"></video></main>`, '', ''));

const short = page('/short/', doc('<main><h1>Liên hệ</h1>' + para(20) + '</main>'));
const site = { host: HOST, start: `https://${HOST}/`, pages: [good, weak, short], sitemap: { count: 3, media: { images: 0, videos: 0 } } };

const issues = geoChecks(site);
const by = Object.fromEntries(issues.map((i) => [i.id, i]));
const urls = (id) => (by[id]?.urls || []).map((u) => u.url);

assert.ok(weak.charset === '' && good.charset === 'utf-8');
assert.deepEqual(urls('charset-not-utf8'), [weak.url]);
assert.deepEqual(urls('doctype-missing'), [weak.url]);
assert.deepEqual(urls('h1-length'), [weak.url]);
assert.deepEqual(urls('alt-duplicate'), [weak.url]);
assert.match(by['alt-duplicate'].urls[0].note, /ảnh minh hoạ" × 2/);
assert.deepEqual(urls('internal-nofollow'), [weak.url]);
assert.equal(by['anchor-multi-target'].urls.length, 1);
assert.match(by['anchor-multi-target'].urls[0].note, /"dịch vụ thiết kế" → 2 URL/);
assert.deepEqual(urls('heading-ids-missing'), [weak.url]);
assert.deepEqual(urls('no-structured-blocks'), [weak.url]);
assert.deepEqual(urls('long-paragraphs'), [weak.url]);
assert.deepEqual(urls('no-concrete-figures'), [weak.url]);
assert.deepEqual(urls('no-outbound-sources'), [weak.url], 'a share button is not a source');
assert.deepEqual(urls('video-schema-missing'), [weak.url]);
assert.ok(!urls('figcaption-missing').includes(good.url), 'page with a figcaption is fine');
assert.deepEqual(urls('figcaption-missing'), [weak.url]);
// under 10 pages with content images: only the video part is reported
assert.match(by['media-sitemap-missing'].fix, /video sitemap/);
assert.doesNotMatch(by['media-sitemap-missing'].fix, /ảnh nội dung/);
// the short contact page is never treated as an article
assert.ok(issues.every((i) => !i.urls.some((u) => u.url === short.url) || ['charset-not-utf8', 'doctype-missing'].includes(i.id)));
assert.ok(issues.every((i) => i.urls.every((u) => u.url !== good.url)), 'the good article raises nothing');

// video sitemap: a page with video and a sitemap without <video:video>
const vid = geoChecks({ ...site, pages: [good] });
assert.match(vid.find((i) => i.id === 'media-sitemap-missing').fix, /video sitemap/);

// pages from an older cached crawl (no new fields) are skipped, not flagged
const legacy = { ...weak };
for (const k of ['charset', 'html5Doctype', 'paraCount', 'figcaptions']) delete legacy[k];
const old = geoChecks({ ...site, pages: [legacy], sitemap: { count: 1 } });
assert.ok(!old.some((i) => ['charset-not-utf8', 'doctype-missing', 'long-paragraphs', 'figcaption-missing', 'media-sitemap-missing'].includes(i.id)));

// llms.txt probes
assert.equal(geoProbeChecks({ llms: { status: 404 } })[0].id, 'llms-missing');
assert.equal(geoProbeChecks({ llms: { status: 200 }, llmsFull: { status: 404 } })[0].id, 'llms-full-missing');
assert.equal(geoProbeChecks({ llms: { status: 200 }, llmsFull: { status: 200 } }).length, 0);
assert.equal(geoProbeChecks(null).length, 0);

console.log(`PASS geo checks: ${issues.length} issues on the weak page, none on the good one; legacy pages skipped; llms probes`);

// Real-site refinements: a decorative hero video, CTA anchors and non-editorial long pages are not flagged.
const home = page('/', doc(`<main><h1>Enosta builds digital products</h1>${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}${para(45)}
  <video id="hero" muted playsinline autoplay></video><a href="/s1/">explore</a><a href="/s2/">Explore</a></main>`));
assert.equal(home.videoEmbeds, 0, 'muted autoplay background video is decoration');
assert.ok(home.words >= 800);
const hi = geoChecks({ ...site, pages: [home], sitemap: { count: 1, media: { images: 0, videos: 0 } } });
assert.ok(!hi.some((i) => ['video-schema-missing', 'anchor-multi-target', 'no-outbound-sources', 'no-concrete-figures'].includes(i.id)), hi.map((i) => i.id).join());
assert.equal(extract('<video controls src="/a.mp4"></video>', 'https://ex.com/').videoEmbeds, 1, 'a playable video still counts');
console.log('PASS refinements: hero video, CTA anchors, non-editorial pages');
// lightbox image links and "view …" buttons are not ambiguous topical anchors; a real topical anchor still is
const lb = page('/blog/lb/', doc(`<main><h1>Team culture at Enosta</h1>${para(30)}<a href="/a.jpg">enosta</a><a href="/b.jpg">enosta</a>
  <a href="/cs/1/">view case study</a><a href="/cs/2/">view case study</a><a href="/x/">mvp development</a><a href="/y/">mvp development</a></main>`));
const al = geoChecks({ ...site, pages: [lb], sitemap: { count: 1 } }).find((i) => i.id === 'anchor-multi-target');
assert.equal(al.urls.length, 1);assert.match(al.urls[0].note, /"mvp development"/);
console.log('PASS anchors: file links and CTA buttons ignored');
