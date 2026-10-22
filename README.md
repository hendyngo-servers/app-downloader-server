# App Downloader Server — Cloudflare + Render Free

Hendy Hub là cổng phát hành phần mềm gồm User Portal và Admin Developer Portal. Mã nguồn hỗ trợ ba cách triển khai dùng chung API:

1. Render Free chạy Node.js/Express.
2. Cloudflare Pages phục vụ giao diện tĩnh và Pages Function chuyển tiếp /api/* sang Render.
3. Cloudflare Workers (tùy chọn) phục vụ cùng giao diện và proxy API bằng file cấu hình riêng.

Metadata và gói APK/EXE/ZIP được lưu trong Cloudflare R2 khi STORAGE_DRIVER=r2, không nằm trên filesystem tạm của Render Free.

Repository: https://github.com/hendyngo-servers/app-downloader-server

## Cấu trúc

    public/                    giao diện người dùng + admin
    functions/api/[[path]].js  Pages Function proxy API
    worker/index.mjs           Worker proxy + static assets
    wrangler.toml              cấu hình Cloudflare Pages
    wrangler.worker.toml       cấu hình Worker độc lập
    server.js                  Node.js + Express API cho Render
    render.yaml                blueprint Render Free
    tests/server.test.js       integration smoke test

## Kiến trúc và lưu trữ

- Render Free xử lý API, đăng nhập admin, tạo ứng dụng, upload/publish build, license, thống kê và tải xuống.
- Cloudflare Pages cung cấp UI ở cùng origin với Pages Function API proxy. Không cần đặt URL API vào public/config.js.
- Cloudflare Worker có thể thay Pages làm lớp phân phối UI/proxy; dùng wrangler.worker.toml.
- Cloudflare R2 lưu data.json và các object uploads/<uuid>.<ext>. R2 giữ dữ liệu qua redeploy/restart và khi Render spin down.
- Render Free sẽ spin down sau thời gian không có lưu lượng; request đầu tiên có thể chờ service khởi động. Filesystem cục bộ của Render Free là ephemeral, nên không lưu dữ liệu cần giữ trong đó.

R2 adapter dùng một object JSON cho metadata. Cách này phù hợp bản demo/portal ít ghi và một Render instance; không phải database giao dịch cho tải cao hoặc nhiều writer đồng thời. Không chạy nhiều bản API ghi cùng một bucket/prefix độc lập cùng lúc.

## 1. Tạo Cloudflare R2 bucket

1. Mở Cloudflare Dashboard → R2 Object Storage.
2. Tạo bucket, ví dụ app-downloader-files; để bucket private.
3. Tạo R2 API token có quyền Object Read & Write chỉ cho bucket này. Dùng Access Key ID và Secret Access Key do R2 cấp, không dùng Global API Key/Account API Token.
4. Lấy Account ID từ Cloudflare. Endpoint S3 có dạng https://<ACCOUNT_ID>.r2.cloudflarestorage.com

Không commit Access Key, Secret Key, mật khẩu admin hoặc session secret vào GitHub. Nếu đã từng commit một secret thật, hãy thu hồi và tạo secret mới.

## 2. Deploy API lên Render Free

### Với service mới

1. Vào https://dashboard.render.com/blueprints và tạo Blueprint từ repository này, nhánh main.
2. Blueprint dùng Node.js 22, npm install, npm start, health check /api/health và plan free; không khai báo Persistent Disk.
3. Điền ADMIN_USERNAME và ADMIN_PASSWORD riêng, đủ mạnh. SESSION_SECRET được sinh tự động.
4. Thêm các biến môi trường sau trong Render → Service → Environment:

| Biến | Giá trị |
| --- | --- |
| STORAGE_DRIVER | r2 |
| R2_ENDPOINT | https://<ACCOUNT_ID>.r2.cloudflarestorage.com |
| R2_BUCKET | Tên bucket đã tạo |
| R2_ACCESS_KEY_ID | Access Key ID của R2 |
| R2_SECRET_ACCESS_KEY | Secret Access Key của R2 |
| R2_PREFIX | app-downloader-server |
| UPLOAD_DIR | /tmp/app-downloader/uploads |
| DATA_FILE | /tmp/app-downloader/data.json (không dùng trong R2 mode) |
| NODE_ENV | production |
| COOKIE_SAME_SITE | lax |
| SESSION_TTL_HOURS | 12 |
| MAX_UPLOAD_MB | 500 |

Với secret variables, dán giá trị ngay trong Render Dashboard, không ghi vào file YAML.

### Với service Render đang tồn tại

Blueprint không tự động biến một service tạo thủ công thành Blueprint-managed. Giữ service hiện tại và mở Environment; đặt tối thiểu STORAGE_DRIVER=r2, UPLOAD_DIR=/tmp/app-downloader/uploads và bốn biến R2 (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). Xóa hoặc thay mọi UPLOAD_DIR=/var/data/uploads còn sót lại. Không cần Persistent Disk khi R2 đã cấu hình.

Sau khi lưu env vars, Render sẽ khởi động lại/deploy. Kiểm tra:
- https://<your-service>.onrender.com/api/health
- https://<your-service>.onrender.com/
- https://<your-service>.onrender.com/admin.html

Health check chỉ xác nhận tiến trình API đang chạy; hãy kiểm thử thêm upload và tải xuống để xác nhận R2 được cấu hình đúng.

## 3. Deploy Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Chọn repository này và nhánh main.
3. Build command: để trống; Build output directory: public; root directory để mặc định ở repo root.
4. Mở Settings → Variables and Secrets, thêm biến BACKEND_ORIGIN bằng URL HTTPS Render thật, ví dụ https://your-service.onrender.com (không thêm dấu / cuối).
5. Deploy/redeploy lại Pages.

Thư mục functions/ ở root tạo Pages Function cho đường dẫn /api/*. Request API được proxy từ domain Pages tới Render; cookie admin được trả về cho domain Pages, nên frontend và API dùng cùng origin. Function từ chối request thay đổi dữ liệu có Origin khác domain Pages.

Đường dẫn sau deploy:
- User Portal: https://<your-project>.pages.dev/
- Admin: https://<your-project>.pages.dev/admin.html
- Health check: https://<your-project>.pages.dev/api/health

Pages chỉ cần BACKEND_ORIGIN. Không đặt R2 secret hoặc mật khẩu admin ở Pages.

## 4. Deploy Cloudflare Workers thay cho Pages (tùy chọn)

Worker độc lập có thể phục vụ thư mục public/ và proxy /api/*.

1. Cài Node.js 22 rồi chạy npm install.
2. Sửa BACKEND_ORIGIN trong wrangler.worker.toml thành hostname Render thật.
3. Đăng nhập Wrangler bằng npx wrangler login.
4. Deploy bằng npm run deploy:worker.

Có thể deploy Worker và Pages song song để thử nghiệm, nhưng mỗi domain cần được kiểm tra riêng. Nếu dùng Worker standalone, Worker chỉ cần URL backend; R2 keys chỉ được lưu trong Render vì Render là API writer.

## 5. Local development trên Windows

    npm install
    Copy-Item .env.example .env
    npm start

Sửa .env và thay các placeholder bằng thông tin local. Ở local, giữ STORAGE_DRIVER=local; data.json và uploads/ sẽ nằm trong thư mục dự án. Để thử R2 từ máy local, chuyển STORAGE_DRIVER=r2 và cấu hình đủ biến R2.

Kiểm thử bằng npm test.

## 6. Chức năng

- User Portal: tìm kiếm/lọc ứng dụng, xem phiên bản phát hành, SHA-256 và tải file.
- Admin Developer Portal: đăng nhập, quản lý ứng dụng/build, upload và publish release, license, audit log.
- API: health check, catalog, download, license verify, admin CRUD.
- Định dạng package: APK, AAB, IPA, ZIP, 7Z, RAR, EXE, MSI, DMG, PKG, AppImage, DEB, RPM, TAR, GZ.
- Giới hạn upload mặc định 500 MB, cấu hình qua MAX_UPLOAD_MB.

## 7. API chính

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| GET | /api/health | Health check |
| GET | /api/stats/public | Thống kê công khai |
| GET | /api/apps | Catalog ứng dụng đã publish |
| GET | /api/apps/:appId | Chi tiết ứng dụng |
| GET | /api/download/:buildId | Tải build đã publish |
| POST | /api/license/verify | Kiểm tra license |
| POST | /api/admin/login | Đăng nhập admin |
| GET | /api/admin/overview | Thống kê quản trị |
| GET/POST/PATCH/DELETE | /api/admin/apps, /api/admin/builds, /api/admin/licenses | Quản lý nội dung |

## 8. Giới hạn Free cần biết

- Render Free tự sleep sau thời gian không có traffic; request đầu tiên sau đó có thể mất khoảng một phút để service chạy lại. Không phải lỗi deploy.
- Render Free không có Persistent Disk; chỉ dùng thư mục /tmp để tiếp nhận file tạm trong lúc upload.
- R2 có free tier hàng tháng theo hạn mức Cloudflare, nhưng vượt storage/operation quotas có thể phát sinh phí. Theo dõi Usage & Billing của tài khoản.
- Một JSON object trên R2 phù hợp MVP nhỏ; nên chuyển metadata sang D1/Postgres khi cần concurrency, query nâng cao hoặc nhiều API instances.

Tài liệu:
- Render Free: https://render.com/docs/free
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/
