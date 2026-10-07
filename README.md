# SEO Audit theo patent Google

Công cụ audit website dựa trên kho nghiên cứu **262 patent Google** trong Obsidian (`Google Patent Research`). Mỗi phát hiện trong báo cáo đều ghi rõ patent làm căn cứ và mở được note phân tích trong Obsidian.

Web: https://seo-patent-audit.vercel.app (đăng nhập bằng Google, email phải có trong `ALLOWED_EMAILS`).
Deploy: push lên nhánh `main` của GitHub (`hantran278/seo-patent-audit`) → Vercel tự deploy production; nhánh khác → bản preview.

## Cài đặt (máy local)

Yêu cầu Node.js ≥ 20.

```bash
npm install
node gen-users.mjs tester      # in ra APP_USERS + SESSION_SECRET → chép vào .env.local (không commit)
npm run dev                    # web giao diện tại http://localhost:3000
```

| Thư mục | Nội dung |
|---|---|
| `api/` | Serverless function trên Vercel: `audit` (crawl + phân tích, stream NDJSON), `login`, `google` (đăng nhập + GSC/GA4), `jev`, `mcp` |
| `lib/` | Crawler, trích xuất HTML, chấm điểm, báo cáo HTML, nguồn dữ liệu CSV, Google, Jev, MCP, job nhiều đợt |
| `checks/` | Các nhóm kiểm tra (mỗi lỗi gắn patent), checklist Enosta, backlink |
| `public/` | Giao diện web, trang chính sách quyền riêng tư |
| `checklists/` | File checklist kỹ thuật Enosta (xlsx gốc) |
| `tests/` | Test offline (API Google/Jev giả lập) + dữ liệu giả lập trong `tests/fixtures/` |
| `reports/` | Đầu ra báo cáo + cache crawl (không commit) |

## Kiểm thử

| Lệnh | Kiểm tra |
|---|---|
| `npm test` | Test offline: đăng nhập Google, GSC/GA4, Jev (API giả lập; lần đầu crawl books.toscrape.com 120 URL làm dữ liệu mẫu) |
| `node tests/fixtures/make.cjs` → `node audit.mjs https://books.toscrape.com/ --max 25 --no-psi --file tests/fixtures/internal_all.csv --file tests/fixtures/semrush_positions.csv` | Nhận diện + phân tích file nhập |
| `node tests/fixtures/make-backlinks-demo.cjs` → audit với `--file tests/fixtures/semrush_referring_domains.csv` | Audit backlink + disavow.txt |
| `PORT=3001 npm run dev` → `node tests/api-test.mjs 3001 40` (hoặc `1000` để thử crawl nhiều đợt, cần `BLOB_READ_WRITE_TOKEN`) | API web end-to-end |

Dữ liệu trong `tests/fixtures/` là giả lập; `books.toscrape.com` là site demo công khai dành cho thử crawl.

## Chạy bằng dòng lệnh

```bash
node audit.mjs https://domain.com --max 300 --brand "Tên thương hiệu,tên gọi khác"
```

Tuỳ chọn:

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--max 300` | Số URL tối đa crawl (mặc định 300) |
| `--brand "A,B"` | Tên thương hiệu (dùng cho tỷ lệ tìm thương hiệu, title trang chủ, anchor) |
| `--file a.csv --file b.csv …` | Nhiều file dữ liệu bất kỳ: GSC, Screaming Frog, Semrush, Ahrefs (tự nhận loại theo tên cột, xem bên dưới) |
| `--gsc file.csv` | Dữ liệu Google Search Console (cách cũ, vẫn dùng được) |
| `--backlinks file.csv` | Backlink export từ Ahrefs/Semrush/GSC (cách cũ, vẫn dùng được) |
| `--out file.html` | Đường dẫn báo cáo (mặc định `reports/<domain>-<ngày>.html`) |
| `--cache` | Dùng lại dữ liệu crawl lần trước (không crawl lại) |
| `--delay 250` | Nghỉ giữa các request (ms) |
| `--json` | Xuất thêm file JSON dữ liệu thô |

## Checklist kỹ thuật (Enosta)

Mặc định công cụ đánh giá checklist `checklists/Enosta Dev_SEO Checklist.xlsx` (9 sheet, 124 hạng mục) và xuất:
- Tab **Checklist** trong báo cáo HTML (lọc theo sheet / ưu tiên / trạng thái).
- File **`<báo cáo> - Enosta Dev_SEO Checklist.xlsx`**: bản sao checklist với cột *Trạng thái* điền theo danh sách của Enosta (Đạt → Đã xong, Chưa đạt → Chưa làm, Một phần → Đang làm, Thủ công → Chờ review, Không áp dụng → N/A) và 3 cột mới: *Kết quả audit tự động*, *Bằng chứng audit*, *Patent căn cứ*.

Để đánh giá được, công cụ thăm dò thêm: header bảo mật/cache/CDN/nén của trang chủ, URL 404 ngẫu nhiên (soft-404), biến thể trailing slash, subdomain staging/dev, user-agent mobile/Googlebot/GPTBot/ClaudeBot/PerplexityBot, `/llms.txt`, dung lượng ảnh (HEAD) và **PageSpeed Insights** (field data CrUX + Lighthouse) cho trang chủ và 3 trang mẫu.

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--checklist file.xlsx` | Dùng checklist khác (cùng cấu trúc cột Hạng mục / Tiêu chí / Trạng thái) |
| `--no-checklist` | Bỏ phần checklist |
| `--psi-key KEY` (hoặc biến môi trường `PSI_KEY`) | API key PageSpeed Insights — **cần có**, quota dùng chung không key thường hết (lỗi 429). Tạo miễn phí: Google Cloud Console → APIs → PageSpeed Insights API → Credentials |
| `--no-psi` | Bỏ PageSpeed Insights |

Hạng mục không tự động được (quy trình, quyền truy cập, quyết định policy) được đánh dấu *Cần kiểm tra thủ công* kèm gợi ý công cụ lấy từ chính checklist.

## File dữ liệu nhập (web: kéo-thả nhiều file · CLI: `--file`)

Loại file được nhận diện từ tên cột (`lib/sources.mjs`), mã hoá UTF-8 hoặc UTF-16 (Ahrefs), phân cách `,` `;` hoặc tab. Chỉ nhận CSV.

| Nguồn | File | Nhận diện qua cột | Dùng cho |
|---|---|---|---|
| Google Search Console | Queries.csv, Pages.csv (Hiệu suất → Xuất), Links | Clicks/Lượt nhấp + Impressions/Lượt hiển thị | CTR vs vị trí, thương hiệu, cannibalization, trang có traffic nhưng lỗi |
| Screaming Frog | `internal_all.csv` (Internal → All → Export) | Address + Indexability / Status Code / Crawl Depth | Lỗi 4xx/5xx, redirect, non-indexable, title/meta/H1, trang mỏng, độ sâu, inlink, tốc độ phản hồi, URL tool chưa crawl tới (JS / quá giới hạn URL) |
| Semrush / Ahrefs | Organic Positions / Organic keywords | Keyword + Position | Từ khoá vị trí 11–20, cannibalization theo URL, trang đang xếp hạng nhưng lỗi/noindex |
| Semrush / Ahrefs / GSC | Backlinks, Referring domains, Links | Source URL / Referring page URL / Linking site | DR thấp, không traffic, cụm IP, anchor tối ưu quá mức |
| Semrush Site Audit | Export issues | Issue + URL (hoặc dạng cột theo từng lỗi) | Đưa vào báo cáo để đối chiếu (mức info, không trừ điểm) |

Trên web, file được đọc và nén gzip ngay trong trình duyệt (Screaming Frog chỉ giữ ~16 cột cần dùng) để vượt giới hạn 4,5 MB/request của Vercel; ~60.000 URL Screaming Frog ≈ 0,7 MB sau nén.

## Crawl toàn bộ site (nhiều đợt)

Chọn 1.000 / 2.000 / 5.000 URL ở ô "Số URL tối đa": trình duyệt gọi `/api/audit` với `mode: "batch"` nhiều lần, mỗi đợt crawl ~3,5 phút; trạng thái crawl (hàng đợi + dữ liệu trang, nén gzip, ~1 KB/trang) lưu trong Vercel Blob **private** `seo-audit-crawl` (`crawl-jobs/<id>.json.gz`, biến `BLOB_READ_WRITE_TOKEN`). Khi hàng đợi hết hoặc đủ số URL, lệnh cuối gửi `jobId` để gộp và phân tích như audit thường, rồi xoá dữ liệu tạm; job bỏ dở tự xoá sau 24 giờ. Phải giữ tab mở trong lúc chạy; đợt lỗi mạng tự thử lại 2 lần. Code: `initCrawl / crawlStep / finishCrawl` trong `lib/crawler.mjs`, `lib/jobs.mjs`.

## Đăng nhập bằng Google

Màn hình đăng nhập dùng nút **Đăng nhập bằng Google**: một lần đăng nhập vừa vào công cụ vừa cấp quyền đọc GSC/GA4 (lần sau chỉ chọn tài khoản, không hỏi lại quyền). Ai được vào do biến `ALLOWED_EMAILS` quyết định: email cách nhau bằng dấu phẩy, mục bắt đầu bằng `@` cho phép cả tên miền, ví dụ `a@gmail.com, b@gmail.com, @enosta.com`. Sửa biến rồi Redeploy; xoá email khỏi danh sách là phiên của người đó hết hiệu lực ngay.

Đăng nhập tài khoản/mật khẩu (`APP_USERS`) vẫn giữ làm dự phòng (link "Đăng nhập bằng tài khoản nội bộ"). Đăng xuất xoá luôn kết nối Google trên trình duyệt đó.

## Kết nối Google Search Console & GA4 (web)

Mỗi thành viên bấm **Kết nối Google** trên form, đăng nhập tài khoản Google có quyền xem property, rồi chọn property GSC / GA4 (tự gợi ý theo domain). Tool lấy 90 ngày: GSC truy vấn × trang (tối đa 50.000 dòng), GA4 landing page kênh Organic Search (phiên, tương tác, key event). Refresh token được mã hoá AES-GCM trong cookie HttpOnly của trình duyệt người đó (180 ngày); server không lưu.

Kiểm tra thêm từ GA4: landing page organic tương tác thấp, trang nhiều traffic chưa có key event, landing page không nằm trong lượt crawl; trang đang có click/phiên nhưng lỗi/noindex (gộp GSC + GA4 + Semrush).

Cấu hình một lần (Google Cloud Console):
1. Tạo project → APIs & Services → Library: bật **Google Search Console API**, **Google Analytics Data API**, **Google Analytics Admin API**.
2. OAuth consent screen: *Internal* nếu dùng Google Workspace công ty (không cần Google duyệt); *External* thì để ở chế độ Testing và thêm email từng thành viên vào Test users (token Testing hết hạn sau 7 ngày, phải kết nối lại).
3. Credentials → Create OAuth client ID → *Web application* → Authorized redirect URI: `https://seo-patent-audit.vercel.app/api/google` (thêm `http://localhost:3000/api/google` nếu chạy local).
4. Vercel → Environment Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → Redeploy. Chưa có 2 biến này thì khung Google tự ẩn.

## MCP: gọi tool từ Claude / ChatGPT

Endpoint `https://seo-patent-audit.vercel.app/api/mcp` (Streamable HTTP, stateless). Có 3 tool:

| Tool | Làm gì | Thời gian |
|---|---|---|
| `audit_site` | Audit cả site (điểm 11 nhóm, vấn đề xếp ưu tiên, URL ví dụ, cách sửa, patent); tuỳ chọn thêm checklist Enosta | 5 giây – 4 phút tuỳ `max_pages` (tối đa 150 trên web) |
| `check_page` | Yếu tố on-page của 1 URL (title, meta, heading, canonical, robots, schema, link, ảnh, tác giả/ngày, trích nội dung) | vài giây |
| `find_patent` | Tra kho ~260 patent theo mã hoặc từ khoá (vi/en) | tức thì |

**Token**: biến môi trường `MCP_TOKENS="claude:<token>;chatgpt:<token>"` trên Vercel (mỗi token ≥ 24 ký tự, xoá một mục để thu hồi). Gửi token qua header `Authorization: Bearer <token>` hoặc `?key=<token>` trên URL.

- **Claude.ai** (Pro/Max/Team/Enterprise): Settings → Connectors → *Add custom connector* → URL `https://seo-patent-audit.vercel.app/api/mcp?key=<token claude>`. Team/Enterprise: chủ workspace thêm ở Organization settings → Connectors.
- **ChatGPT** (gói có Developer mode): Settings → Apps & Connectors → Advanced → bật *Developer mode* → tạo connector với URL `…/api/mcp?key=<token chatgpt>`, Authentication: *No authentication*.
- **Claude Code**: `claude mcp add --transport http seo-audit https://seo-patent-audit.vercel.app/api/mcp --header "Authorization: Bearer <token>"`
- **Chạy cục bộ (không giới hạn thời gian/URL)**: Claude Code `claude mcp add seo-audit -- node "<đường dẫn>/seo-audit/mcp-stdio.mjs"`; Claude Desktop thêm vào `claude_desktop_config.json`: `{"mcpServers":{"seo-audit":{"command":"node","args":["<đường dẫn>/seo-audit/mcp-stdio.mjs"]}}}`.

Gợi ý khi chat: để `max_pages` ≤ 60 cho nhanh; dùng `check_page` để so trang mình với trang đối thủ đang top; hỏi `find_patent` để giải thích "vì sao" một lỗi quan trọng. Kiểm tra: `node tests/mcp-test.mjs https://seo-patent-audit.vercel.app <token>`.

## Dữ liệu GSC

- Cách nhanh: GSC → Hiệu suất → Xuất → tải CSV, lấy file **Queries.csv** (Truy vấn). Đủ cho: CTR so với kỳ vọng vị trí, cơ hội vị trí 11–20, tỷ lệ tìm thương hiệu.
- Đầy đủ: dữ liệu **Truy vấn + Trang** (API / Looker Studio / add-on "Search Analytics for Sheets") với cột `query, page, clicks, impressions, ctr, position` → thêm phát hiện **cannibalization**.
- Tên cột tiếng Việt hoặc tiếng Anh đều được nhận.

## Backlink

CSV từ Ahrefs (Backlinks hoặc Referring domains), Semrush hoặc GSC → Liên kết. Công cụ tự nhận cột: URL/domain nguồn, anchor, DR, traffic, IP → phân tích tỷ lệ link kém, link không traffic, cụm cùng IP (mạng vệ tinh), anchor bị tối ưu quá mức.

## Các module

| Nhóm | Kiểm tra | Patent chính |
|---|---|---|
| Crawl & index (P1) | robots, sitemap (tồn tại, URL không chuẩn, lastmod giả), lỗi 4xx/5xx, chuỗi redirect, trang mồ côi, độ sâu, URL tham số, TTFB | US9355177, US8554759, US7509315, US8868541 |
| Trùng lặp & canonical (P1) | biến thể host, canonical thiếu/nhiều/hỏng, title/meta trùng, nội dung gần trùng (simhash) | US8868559, US9275143, US8548972, US7930400 |
| Chất lượng site (P1) | tỷ lệ trang mỏng, đoạn template lặp, trang tin cậy, lệch chủ đề, tỷ lệ click thương hiệu (GSC) | US9031929, US8682892, US9767157, US8548995 |
| Liên kết (P1) | PageRank nội bộ, trang ít link, anchor chung chung, link ngữ cảnh, link ra sitewide, backlink | US6285999, US7716225, US10210256, US9002832, US8825645 |
| Tín hiệu người dùng (P1) | CTR so với kỳ vọng vị trí, ứng viên đẩy top | US8661029, US8938463, US9020927 |
| Spam (P1) | nhồi từ khoá, văn bản ẩn (CSS inline) | US7603345, US9336279 |
| Chủ đề & cấu trúc (P2) | H1, heading nhảy cấp, bài dài không H2, H1–title–URL khớp entity, danh sách giả | US10068022, US8060501, US9959315 |
| Ý định & từ khoá (P2) | cannibalization, vị trí 11–20 | US8452766, US9323806 |
| Thực thể (P2) | schema Organization, trường thiếu, lỗi JSON-LD, độ phủ schema, thương hiệu trong title | US8682913, US10331706 |
| Trải nghiệm trang (P2) | HTTPS, viewport, mixed content, HTML nặng, alt ảnh | US20160314215, US8645362 |
| Tác giả & độ tươi (P3) | thông tin tác giả, ngày đăng/cập nhật trên bài viết | US8150842, US9177074 |

## Giới hạn

- Crawler đọc HTML tĩnh, **không chạy JavaScript**: site render bằng JS (SPA) sẽ thiếu nội dung; văn bản ẩn chỉ phát hiện qua style inline.
- Core Web Vitals cần dữ liệu thực tế (GSC/CrUX), công cụ không đo được.
- Điểm số là **chỉ báo ưu tiên**, không phải điểm của Google. Patent cho biết Google đo gì, không cho biết trọng số.

## Cập nhật khi vault có thêm phân tích

```bash
node build-patents.mjs
```
