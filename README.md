# App Downloader Server — Hendy Hub

Developer portal để **quản lý ứng dụng, tải lên gói build, xuất bản release và quản lý license**, với hai giao diện tách biệt:

- **User Portal:** catalog ứng dụng công khai, tìm kiếm/lọc, thông tin phiên bản, checksum SHA-256 và tải gói đã xuất bản.
- **Admin Developer Portal:** đăng nhập riêng, tạo/sửa/ẩn ứng dụng, upload package, publish/unpublish build, quản lý license và xem audit log.

Repository: https://github.com/hendyngo-servers/app-downloader-server

## 1. Cấu trúc

    app-downloader-server/
    ├── uploads/                   # Gói build (không commit binary)
    ├── public/
    │   ├── index.html              # Giao diện người dùng
    │   ├── admin.html              # Admin Developer Portal
    │   ├── style.css               # Glassmorphism / Cyber Neon / responsive
    │   ├── script.js               # Logic giao diện user
    │   ├── admin.js                # Logic giao diện admin
    │   ├── config.js               # API base URL công khai (không chứa secret)
    │   └── _headers                # Header bảo vệ khi chạy Cloudflare Pages
    ├── data.json                   # Metadata apps/builds/licenses/stats/audit
    ├── server.js                   # API Express, auth, upload và download
    ├── package.json
    ├── render.yaml                 # Blueprint Render + persistent disk
    ├── Dockerfile
    ├── wrangler.toml               # Cloudflare Pages static output
    └── .github/workflows/          # CI + GitHub Pages deploy

Không thêm file .apk, .exe, .zip lớn vào Git. Package được upload qua Admin Portal và lưu trong UPLOAD_DIR.

## 2. Chạy local trên Windows

Cần Node.js 20+ (khuyến nghị Node.js 22).

Mở CMD/PowerShell trong thư mục dự án:

    npm install
    Copy-Item .env.example .env

Mở file .env, thay ADMIN_PASSWORD bằng mật khẩu mạnh và SESSION_SECRET bằng chuỗi ngẫu nhiên tối thiểu 32 ký tự. Có thể tạo secret bằng:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

Khởi động:

    npm start

Truy cập:
- User Portal: http://localhost:3000/
- Admin Portal: http://localhost:3000/admin.html
- Health check: http://localhost:3000/api/health

Kiểm tra cú pháp:

    npm test

## 3. Deploy backend lên Render

1. Mở Render Dashboard và chọn **New → Blueprint**.
2. Chọn repository hendyngo-servers/app-downloader-server, dùng render.yaml.
3. Khi được yêu cầu, đặt ADMIN_USERNAME và ADMIN_PASSWORD. Không đưa các giá trị này vào repository.
4. Render Blueprint định nghĩa một web service Node.js và persistent disk tại /var/data. Dữ liệu được lưu ở /var/data/data.json, package tại /var/data/uploads.
5. Sau khi deploy, kiểm tra URL dạng https://your-service.onrender.com/api/health.

Các biến môi trường quan trọng:
- ADMIN_USERNAME, ADMIN_PASSWORD: tài khoản quản trị.
- SESSION_SECRET: bí mật ký session; Blueprint tạo giá trị ngẫu nhiên.
- DATA_FILE=/var/data/data.json, UPLOAD_DIR=/var/data/uploads: dùng persistent disk, tránh mất package khi redeploy.
- CORS_ORIGINS: danh sách origin của frontend tách riêng, phân cách bằng dấu phẩy; ví dụ https://your-site.pages.dev.
- COOKIE_SAME_SITE=none: cần khi Admin Portal và API ở hai site khác nhau; chỉ dùng qua HTTPS.
- MAX_UPLOAD_MB: giới hạn dung lượng mỗi package (mặc định 500 MB).

Nếu dùng giao diện cùng host Render, hãy để public/config.js với API_BASE_URL là chuỗi rỗng và có thể cấu hình cookie lax. Khi frontend được host ở domain khác, dùng COOKIE_SAME_SITE=none và điền chính xác origin trong CORS_ORIGINS.

## 4. Deploy giao diện lên Cloudflare Pages

Cloudflare Pages phù hợp để host **hai trang tĩnh**; Express API, đăng nhập admin, JSON data và uploads vẫn cần backend riêng (ví dụ Render).

1. Trong Cloudflare Dashboard chọn **Workers & Pages → Create → Pages → Connect to Git**.
2. Chọn repository này.
3. Build command: để trống (hoặc lệnh no-op được Cloudflare hỗ trợ).
4. Build output directory: public.
5. Trước/sau lần deploy đầu, sửa public/config.js để trỏ đến backend Render:

    window.APP_CONFIG = {
      API_BASE_URL: "https://your-service.onrender.com"
    };

6. Commit thay đổi này. Trên Render đặt CORS_ORIGINS là origin Pages thực tế, ví dụ https://your-project.pages.dev (không thêm đường dẫn), cùng COOKIE_SAME_SITE=none.
7. Truy cập https://your-project.pages.dev/ và https://your-project.pages.dev/admin.html.

API base URL không phải secret. Tuyệt đối không đặt admin password, session secret hay token trong public/config.js.

Có thể dùng Cloudflare R2 để lưu package ở bước nâng cấp tiếp theo; bản hiện tại lưu file trên persistent disk của Render, chưa tự cấu hình bucket R2.

## 5. Deploy giao diện lên GitHub Pages

Workflow .github/workflows/pages.yml publish thư mục public sau push lên main. Trong GitHub vào **Settings → Pages → Build and deployment → Source: GitHub Actions** nếu repository chưa được cấu hình. Xem kết quả tại tab **Actions**.

Để GitHub Pages gọi API Render, sửa public/config.js với API_BASE_URL của backend và thêm origin GitHub Pages vào CORS_ORIGINS. Với project site, origin thường là https://your-owner.github.io (origin không bao gồm /app-downloader-server/). Giao diện dùng đường dẫn tương đối cho asset để tương thích với đường dẫn con.

GitHub Pages chỉ host static HTML/CSS/JS, không chạy server.js, không lưu data.json, không xử lý upload hoặc bảo vệ API. Không thể triển khai toàn bộ backend Express chỉ bằng GitHub Pages.

## 6. Docker

    docker build -t app-downloader-server .
    docker run --rm -p 3000:3000 \
      -e NODE_ENV=production \
      -e ADMIN_USERNAME=developer \
      -e ADMIN_PASSWORD='replace-with-a-long-unique-password' \
      -e SESSION_SECRET='replace-with-at-least-32-random-characters' \
      -v app-downloader-data:/var/data \
      app-downloader-server

Khi dùng Docker, luôn cấp secret qua secret manager hoặc môi trường runtime, không bake vào image. Dữ liệu được mount tại /var/data.

## 7. Quy trình phát hành

1. Mở /admin.html và đăng nhập.
2. Tạo ứng dụng trong mục **Ứng dụng**.
3. Sang **Bản build → Tải bản build**, chọn ứng dụng, phiên bản, nền tảng và file package.
4. Upload mặc định tạo build ở trạng thái draft; server tính checksum SHA-256.
5. Kiểm tra version, file và release notes, sau đó bấm **Publish**.
6. Ứng dụng/build đã publish xuất hiện ở User Portal và có đường dẫn tải công khai.
7. License được tạo ở mục **License**; mã mới chỉ được hiển thị sau khi tạo, hãy lưu an toàn.

Các định dạng upload hiện cho phép gồm APK/AAB/IPA, ZIP/7Z/RAR, EXE/MSI, DMG/PKG, AppImage, DEB/RPM, TAR/GZ. Có thể điều chỉnh ALLOWED_EXTENSIONS trong server.js.

## 8. API chính

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| GET | /api/health | Health check |
| GET | /api/stats/public | Thống kê công khai |
| GET | /api/apps | Danh mục ứng dụng đã publish |
| GET | /api/apps/:appId | Chi tiết ứng dụng công khai |
| GET | /api/download/:buildId | Tải gói đã publish |
| POST | /api/license/verify | Kiểm tra trạng thái/thời hạn license |
| POST | /api/admin/login | Đăng nhập admin |
| POST | /api/admin/logout | Đăng xuất |
| GET | /api/admin/overview | Dashboard stats |
| GET/POST/PATCH/DELETE | /api/admin/apps và /api/admin/apps/:appId | CRUD ứng dụng |
| GET | /api/admin/builds | Danh sách build |
| POST | /api/admin/apps/:appId/builds | Upload package (multipart/form-data, field package) |
| PATCH/DELETE | /api/admin/builds/:buildId | Publish hoặc xóa build |
| GET/POST | /api/admin/licenses | Danh sách/tạo license |
| PATCH | /api/admin/licenses/:licenseId | Activate/suspend/revoke |
| GET | /api/admin/audit | Audit log |

Các endpoint /api/admin/* (ngoại trừ login) yêu cầu session cookie đã ký. API kiểm tra origin cho các thao tác thay đổi dữ liệu, giới hạn tốc độ request, giới hạn file upload và chỉ cho tải xuống build công khai.

## 9. Giới hạn và khuyến nghị production

- data.json là kho dữ liệu đơn giản, phù hợp MVP hoặc một instance. Cơ chế ghi dùng file tạm và rename, nhưng **không thay thế database giao dịch** cho triển khai nhiều instance/ nhiều tiến trình.
- Dùng đúng một instance khi đang dùng JSON file; không bật autoscaling với JSON store. Với tải cao, chuyển metadata sang PostgreSQL và package sang Cloudflare R2/S3-compatible object storage.
- Render persistent disk là phần quan trọng để giữ package qua lần deploy/restart; kiểm tra quota disk định kỳ.
- License verify hiện kiểm tra code, status và expiry. Theo dõi thiết bị, quota activation thực tế, thanh toán và chống chia sẻ license cần một activation API đầy đủ.
- CI chạy integration smoke test cho health check, session admin, tạo app, upload/publish/download package, license verify và kiểm tra cú pháp JavaScript. Trước khi phát hành công khai, vẫn nên bổ sung kiểm thử bảo mật và tải cao trong môi trường staging.
- Không lưu mật khẩu, API key, cookie session, access token hay file người dùng nhạy cảm trong GitHub.

## License

Chưa chỉ định license nguồn mở. Hãy thêm file LICENSE phù hợp trước khi phân phối mã nguồn theo giấy phép cụ thể.
