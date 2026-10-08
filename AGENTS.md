# seo-patent-audit: hướng dẫn cho AI agent (Claude Code, Codex)

File này dùng chung cho cả hai tool. Claude Code đọc qua `CLAUDE.md` (dòng `@AGENTS.md`), Codex đọc trực tiếp. Trao đổi với user bằng tiếng Việt.

**Trước khi làm:** đọc `HANDOFF.md` để biết việc đang dở (file chỉ có trên máy, không lên Git).
**Sau khi làm xong:** thêm một mục vào đầu `HANDOFF.md` theo mẫu trong file đó.

## Dự án
Tool audit SEO dựa trên ~275 patent Google. Nhập URL rồi crawl site, chạy các check, xuất báo cáo HTML và file checklist Enosta (xlsx).
- Production: https://seo-patent-audit.vercel.app. Push lên `main` thì Vercel tự deploy.
- Repo: https://github.com/hantran278/seo-patent-audit (**public**: không commit gì riêng tư).
- Dữ liệu patent lấy từ repo `hantran278/seo-patent-research`, trên máy là `C:\Users\PC\Documents\Obsidian Vault`. Cập nhật bằng `node build-patents.mjs "<đường dẫn repo đó>"`, kết quả ghi ra `lib/patents.json`.

## Stack và cấu trúc
Node ≥ 20, ESM, chạy trên Vercel serverless (maxDuration 300 giây, body tối đa 4,5 MB). Không dùng framework.

| Đường dẫn | Vai trò |
|---|---|
| `api/audit.js` | Endpoint chính, stream NDJSON. Chế độ `mode:'batch'` crawl nhiều đợt, lưu state vào Vercel Blob (`lib/jobs.mjs`) |
| `api/google.js`, `lib/google.mjs` | Đăng nhập Google OAuth và lấy dữ liệu GSC/GA4. Refresh token mã hoá AES-GCM, lưu trong cookie `sa_google` |
| `api/login.js`, `lib/auth.mjs` | Session (cookie `sa_session`, ký HMAC) và allowlist `ALLOWED_EMAILS` |
| `api/mcp.js`, `lib/mcp.mjs`, `mcp-stdio.mjs` | MCP server với các tool `audit_site`, `check_page`, `find_patent`, xác thực bằng token `MCP_TOKENS` |
| `api/jev.js`, `lib/jev.mjs` | Gọi Jev (TypeSafe System One), dùng cho phân loại backlink |
| `lib/crawler.mjs` | `initCrawl` → `crawlStep` → `finishCrawl` (crawl tiếp tục được giữa các đợt) |
| `lib/run.mjs` | Điều phối: phân loại file nhập, crawl, chạy check, chấm điểm |
| `lib/sources.mjs` | Tự nhận dạng CSV từ Semrush, Ahrefs, Screaming Frog, GSC |
| `checks/*.mjs` | Các nhóm check. `backlinks.mjs`: audit backlink, cụm IP, đột biến link, disavow. `enosta.mjs`: điền checklist xlsx |
| `lib/report.mjs` | Tạo báo cáo HTML (client nhận bản gzip `htmlGz`) |
| `public/` | Giao diện tiếng Việt (`index.html`) và `privacy.html` |
| `tests/` | Test bằng mock, không tốn API |

## Lệnh
```bash
npm ci
npm test                 # test Google + Jev bằng mock
npm run dev              # dev-server.mjs, http://localhost:3000
node audit.mjs <url>     # chạy audit bằng CLI
```

## Biến môi trường
Chỉ ghi tên ở đây, giá trị nằm trên Vercel hoặc trong `.env.local`:
- `APP_USERS`, `SESSION_SECRET`, `ALLOWED_EMAILS`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `BLOB_READ_WRITE_TOKEN`, `MCP_TOKENS`, `JEV_API_KEY`, `PSI_KEY`
- `BATCH_SECONDS`, `SSRF_GUARD`, `PATENT_RESEARCH_DIR`

## Quy tắc bắt buộc
- **Không đọc, in hay commit** `.env*`, `.env.vercel-keys.txt`, `.env.mcp-tokens.txt`. Không dán key vào chat; user tự nhập key trên Vercel.
- Không tự đăng nhập Google, GitHub hay Vercel thay user.
- File xlsx checklist: sửa thẳng XML trong gói gốc bằng JSZip. **Không round-trip qua exceljs**, vì làm hỏng table style và autoFilter, Excel sẽ không mở được.
- Line ending LF (`.gitattributes`). Commit message tiếng Việt, ngắn gọn.
- Chạy `npm test` trước khi push. Push lên `main` là deploy production, nên hỏi user trước khi push.

## Jev (TypeSafe)
- Endpoint `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer <key>`.
- Body `{model, state, questions}`. Loại câu hỏi: `choice` (trả lựa chọn), `score` (trả điểm), `noul` (trả xác suất "có").
- Giá $0,042 / 1 triệu input token. Tiếng Anh cho kết quả chính xác nhất.
- `confidence` không phải tỉ lệ đúng: ngưỡng phải kiểm thử trên dữ liệu có nhãn.
- Phía Enosta có tool riêng `C:\AI\Enosta\tools\jev-task-review` (Python, do Codex làm) để đánh giá đầu việc trong plan SEO. Hướng hợp nhất ghi trong `C:\AI\Enosta\HANDOFF.md`.
