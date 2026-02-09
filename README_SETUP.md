# Hướng Dẫn Cài Đặt và Chạy Dự Án

Tài liệu này hướng dẫn chi tiết các bước để thiết lập môi trường và chạy **Backend** & **Frontend** của dự án từ đầu.

---

## 1. Yêu Cầu Hệ Thống

Đảm bảo máy của bạn đã cài đặt các công cụ sau:

* **Docker** & **Docker Compose**
* **Node.js** v18+ & **npm**
* **Git**

---

## 2. Clone Dự Án

Mở terminal và chạy các lệnh sau để tải source code về máy:

```bash
git clone https://github.com/mandeotv1234/SA.git
cd SA/infra
```

---

## 3. Cấu Hình Biến Môi Trường (.env)

Dự án yêu cầu một file `.env` tại thư mục **infra** để cấu hình các service.

### Tạo file `.env`

Tạo file `.env` với nội dung sau:

```env
# API KEYS
GEMINI_API_KEY=
SEPAY_API_KEY=
OLLAMA_API_URL=

# AI SERVICE CONFIG
SKIP_LLM_PER_ARTICLE=false

# GMAIL SMTP CONFIG
SMTP_EMAIL=
SMTP_PASSWORD=
```

**Lưu ý:**

* Điền đầy đủ các API Key và thông tin SMTP trước khi chạy hệ thống.
* Không commit file `.env` lên GitHub.

---

## 4. Khởi Động Backend (Docker)

Dự án sử dụng **Docker Compose** để quản lý toàn bộ backend (Database, API Gateway, Core Service, v.v.).

Tại thư mục `infra`, chạy các lệnh sau:

### Build Docker Images

Build lại các image để đảm bảo code mới nhất được sử dụng:

```bash
docker-compose build
```

### Khởi động các Service

```bash
docker-compose up -d
```

* Tùy chọn `-d` giúp các container chạy nền (background).

### Kiểm tra trạng thái container

```bash
docker-compose ps
```

---

## 5. Cài Đặt và Chạy Frontend

Frontend là ứng dụng **React** nằm trong thư mục `web-frontend`.

### Di chuyển vào thư mục Frontend

```bash
cd web-frontend
```

### Cài đặt dependencies

```bash
npm install
```

Nếu gặp lỗi liên quan đến version, có thể thử:

```bash
npm install --legacy-peer-deps
```

### Chạy Development Server

```bash
npm run dev
```

Sau khi chạy thành công, ứng dụng sẽ khả dụng tại:

👉 **[http://localhost:5173](http://localhost:5173)**

---

## 6. Các Đường Dẫn Quan Trọng

* **Frontend App:** [http://localhost:5173](http://localhost:5173)
* **API Gateway (Kong):** [http://localhost:8000](http://localhost:8000)

---

## 7. Troubleshooting (Gỡ Lỗi)

* ❌ **Không kết nối được Database**
  → Kiểm tra container Postgres:

  ```bash
  docker logs infra-postgres-1
  ```

* ❌ **Frontend không gọi được API**
  → Kiểm tra:

  * CORS
  * API Gateway port (mặc định `8000`)

* ❌ **Lỗi Socket.IO / realtime**
  → Đảm bảo **Kong Gateway** đã cấu hình đúng route `/stream-api`.

---

## 8. Video Hướng Dẫn

Bạn có thể xem chi tiết quá trình cài đặt tại video sau:

🎥 **Xem Video Hướng Dẫn:**
[https://youtu.be/HnbUgnDJXIY](https://youtu.be/HnbUgnDJXIY)

---

✨ *Chúc bạn cài đặt thành công!*
