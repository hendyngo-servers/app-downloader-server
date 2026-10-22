# App Downloader Server — Render Web Service

Hendy Hub là ứng dụng Node.js + Express được thiết kế để chạy như **một Render Web Service duy nhất**. Cùng một domain phục vụ website công khai, trang quản trị, API, upload gói phát hành và tải xuống.

Repository: https://github.com/hendyngo-servers/app-downloader-server

## 1. Hai giao diện trên cùng Web Service

- User Portal: trang chủ tại / — tìm kiếm/lọc ứng dụng, xem phiên bản đã xuất bản, checksum SHA-256 và tải gói phát hành.
- Admin Developer Portal: trang /admin.html — đăng nhập admin, quản lý ứng dụng/build/license, publish release và xem audit log.
- API: các endpoint bắt đầu bằng /api.
- Health check: /api/health — dùng cho Render kiểm tra tình trạng Web Service.

Không cần cấu hình API domain riêng. public/config.js để API_BASE_URL là chuỗi rỗng để frontend dùng cùng origin với Express.

## 2. Cấu trúc dự án

    app-downloader-server/
    ├── public/
    │   ├── index.html       # User Portal
    │   ├── admin.html       # Admin Developer Portal
    │   ├── style.css        # Glassmorphism / Cyber Neon / responsive
    │   ├── script.js        # Client logic User Portal
    │   ├── admin.js         # Admin UI logic
    │   └── config.js        # API cùng origin, không chứa secrets
    ├── uploads/             # Gói build khi chạy local
    ├── data.json            # Metadata mẫu ban đầu
    ├── tests/
    │   └── server.test.js   # Integration smoke test
    ├── server.js            # Express web server + API
    ├── package.json
    ├── .node-version        # Node.js 22
    ├── render.yaml          # Render Web Service + persistent disk
    └── Dockerfile

Không commit package thật như APK, EXE hoặc ZIP lên GitHub. Upload file thông qua Admin Portal.

## 3. Deploy bằng Render Blueprint (khuyến nghị)

Repository đã có render.yaml cấu hình một Web Service, lệnh chạy, health check, các biến môi trường và disk cho dữ liệu upload.

1. Mở Render Dashboard: https://dashboard.render.com/blueprints
2. Chọn tạo Blueprint mới và kết nối repository hendyngo-servers/app-downloader-server.
3. Chọn nhánh main và xác nhận cấu hình render.yaml.
4. Khi Render yêu cầu giá trị cho ADMIN_USERNAME và ADMIN_PASSWORD, đặt tên đăng nhập và mật khẩu riêng, đủ mạnh. Không dùng lại mật khẩu của các dịch vụ khác.
5. SESSION_SECRET được sinh tự động bởi Blueprint.
6. Hoàn tất quá trình tạo Blueprint và theo dõi Deploys/Logs đến khi deploy thành công.

Cấu hình dịch vụ hiện dùng region Singapore, Node.js 22, build command npm install, start command npm start và health check /api/health. Mỗi commit mới trên main sẽ kích hoạt deploy tự động.

Sau khi deploy, sử dụng URL mà Render cung cấp:
- Website người dùng: https://<service>.onrender.com/
- Quản trị: https://<service>.onrender.com/admin.html
- Health check: https://<service>.onrender.com/api/health

Thay <service> bằng hostname thực tế do Render cấp; hostname chưa được biết trước khi tạo service.

## 4. Lưu dữ liệu và chi phí Render

render.yaml gắn persistent disk 1 GB tại /var/data. Backend ghi:
- Metadata vào /var/data/data.json.
- Package đã upload vào /var/data/uploads.

Để giữ file upload và dữ liệu qua các lần deploy/restart, cần một Render Web Service plan hỗ trợ persistent disk. Persistent disk không phải bộ nhớ dùng chung nhiều instance; giữ dịch vụ ở một instance khi đang sử dụng JSON file và disk cục bộ.

Nếu bạn chọn gói không hỗ trợ disk, đừng bỏ qua bước lưu trữ: filesystem thông thường của service có thể bị làm mới khi deploy/restart, khiến uploads và dữ liệu JSON mất đi. Trong trường hợp cần chạy gói miễn phí hoặc mở rộng nhiều instance, nên thay JSON file bằng PostgreSQL và lưu package trên Cloudflare R2/S3-compatible object storage trước khi phát hành thật.

## 5. Nếu tạo Web Service thủ công (không dùng Blueprint)

Vào Render Dashboard → New → Web Service và chọn repository này, nhánh main. Cấu hình:
- Runtime: Node
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /api/health
- Node version: 22 (repository có .node-version và engines.node)
- Attach persistent disk mount path /var/data, dung lượng phù hợp.

Tạo các biến môi trường:
- NODE_ENV = production
- DATA_FILE = /var/data/data.json
- UPLOAD_DIR = /var/data/uploads
- COOKIE_SAME_SITE = lax
- SESSION_TTL_HOURS = 12
- MAX_UPLOAD_MB = 500
- ADMIN_USERNAME = tên đăng nhập quản trị do bạn tự đặt
- ADMIN_PASSWORD = mật khẩu quản trị mạnh do bạn tự đặt
- SESSION_SECRET = chuỗi ngẫu nhiên tối thiểu 32 ký tự

Không cần CORS_ORIGINS khi User Portal, Admin Portal và API đều được phục vụ từ cùng Web Service/domain. Nếu sau này tách giao diện ra domain riêng, cần cấu hình lại CORS, cookie SameSite và domain HTTPS tương ứng.

## 6. Chạy local trên Windows

Cần Node.js 22 trở lên. Từ CMD/PowerShell trong thư mục dự án:

    npm install
    Copy-Item .env.example .env

Sửa .env, đặt ADMIN_USERNAME, ADMIN_PASSWORD và SESSION_SECRET (tối thiểu 32 ký tự). Để tạo secret ngẫu nhiên, chạy:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

Sau đó:

    npm start

Mở http://localhost:3000/ hoặc http://localhost:3000/admin.html. Kiểm thử bằng npm test.

## 7. Quy trình xuất bản phần mềm

1. Truy cập /admin.html và đăng nhập.
2. Tạo ứng dụng.
3. Vào Bản build, chọn ứng dụng, version, platform và package.
4. Upload package; server tính SHA-256 checksum.
5. Build mới bắt đầu ở trạng thái draft.
6. Kiểm tra file/phiên bản/release notes rồi bấm Publish.
7. Bản phát hành đã publish sẽ xuất hiện trên User Portal và có đường dẫn tải xuống công khai.

Định dạng được phép upload hiện gồm APK, AAB, IPA, ZIP, 7Z, RAR, EXE, MSI, DMG, PKG, AppImage, DEB, RPM, TAR và GZ. Giới hạn kích thước mặc định 500 MB, cấu hình qua MAX_UPLOAD_MB.

## 8. API chính

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| GET | /api/health | Health check Render |
| GET | /api/stats/public | Thống kê công khai |
| GET | /api/apps | Ứng dụng đã xuất bản |
| GET | /api/apps/:appId | Chi tiết ứng dụng |
| GET | /api/download/:buildId | Tải package đã xuất bản |
| POST | /api/license/verify | Kiểm tra trạng thái và hạn license |
| POST | /api/admin/login | Đăng nhập admin |
| POST | /api/admin/logout | Đăng xuất |
| GET | /api/admin/overview | Thống kê dashboard |
| GET/POST/PATCH/DELETE | /api/admin/apps, /api/admin/apps/:appId | Quản lý ứng dụng |
| GET | /api/admin/builds | Liệt kê build |
| POST | /api/admin/apps/:appId/builds | Upload package |
| PATCH/DELETE | /api/admin/builds/:buildId | Publish hoặc xóa build |
| GET/POST | /api/admin/licenses | Liệt kê/tạo license |
| PATCH | /api/admin/licenses/:licenseId | Activate/suspend/revoke |
| GET | /api/admin/audit | Audit log |

## 9. Kiểm thử tự động và giới hạn

GitHub Actions chạy smoke test trên API: health check, xác thực admin, tạo ứng dụng, upload và publish package, tải file, tạo/xác minh license và thống kê. Workflow CI kiểm tra cú pháp JavaScript.

Đây là nền tảng MVP đã có quy trình phát hành cơ bản, chưa phải nền tảng build mã nguồn trực tiếp. License verify hiện kiểm tra code, trạng thái và thời hạn; chưa thực thi giới hạn kích hoạt theo thiết bị, thanh toán hoặc quản lý quyền nâng cao.

Với dữ liệu quan trọng hoặc lượng tải lớn, hãy chuyển metadata sang PostgreSQL và package sang R2/S3-compatible object storage. JSON file trên một disk không phù hợp để mở rộng nhiều instance. Trước khi phân phối công khai, kiểm thử upload/download lớn, backup/restore, phân quyền và chính sách license trên môi trường staging.

## Bảo mật

Không commit .env, admin password, session secret, API keys hoặc tokens. Sử dụng Environment Variables/Secrets trong Render Dashboard. Tài khoản admin production nên là tài khoản riêng với mật khẩu mạnh.
