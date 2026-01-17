# Tài Liệu Dự Án Hệ Thống Phân Tích & Theo Dõi Thị Trường Crypto

## 1. Tổng Quan
Dự án là một hệ thống microservices toàn diện dùng để thu thập, phân tích và hiển thị dữ liệu thị trường tiền điện tử (Crypto) theo thời gian thực. Hệ thống tích hợp khả năng thu thập tin tức, phân tích cảm xúc (Sentiment Analysis) bằng AI, và cung cấp bảng điều khiển trực quan cho người dùng.

## 2. Kiến Trúc Hệ Thống

Hệ thống được xây dựng trên kiến trúc **Microservices**, sử dụng **Docker Compose** để đóng gói và triển khai.

### Các Thành Phần Chính (Infrastructure)
*   **Kong Gateway (8000, 8001)**: Đóng vai trò là API Gateway, điều hướng mọi request từ Client đến các service tương ứng.
*   **Kafka (9092)**: Message Broker trung tâm, xử lý luồng dữ liệu (streaming) bất đồng bộ giữa các servies (Market data, News, AI insights).
*   **PostgreSQL (5432)**: Database quan hệ (RDBMS) lưu trữ dữ liệu người dùng và cấu hình.
*   **TimescaleDB (5433)**: Database Time-series tối ưu cho việc lưu trữ dữ liệu lịch sử giá và các chỉ số thị trường.
*   **Redis (6379)**: Bộ nhớ đệm (Cache) và hàng đợi tạm thời cho crawler.

### Các Dịch Vụ (Services)

1.  **Web Frontend** (Port 5173 - Dev mode)
    *   **Công nghệ**: React, Vite, TailwindCSS (dự đoán), Axios, Socket.IO.
    *   **Nhiệm vụ**: Hiển thị bảng điều khiển, biểu đồ giá, tin tức và thông tin phân tích AI. Giao tiếp với Backend thông qua Kong Gateway.

2.  **Auth Service** (Port 8081)
    *   **Nhiệm vụ**: Quản lý xác thực người dùng (Đăng ký, Đăng nhập, JWT).
    *   **Database**: PostgreSQL (`appdb`).

3.  **Stream Service** (Port 3002)
    *   **Nhiệm vụ**: Thu thập dữ liệu giá realtime từ các sàn (Binance, etc.) cho các cặp tiền như `BTC/USDT`, `ETH/USDT`.
    *   **Output**: Đẩy dữ liệu vào Kafka (`market_data` topic) hoặc phục vụ qua WebSocket.

4.  **Crawler Service** (Port 8003)
    *   **Nhiệm vụ**: Thu thập tin tức từ nhiều nguồn RSS/Website uy tín (Cointelegraph, CoinDesk, Blogtienao...).
    *   **Quy trình**:
        *   Lưu trạng thái crawl vào Redis.
        *   Đẩy tin tức thô vào Kafka topic `news_raw`.
    *   **Tích hợp**: Sử dụng Gemini API (có thể để tóm tắt hoặc trích xuất).

5.  **AI Service** (Port 8002)
    *   **Nhiệm vụ**: Phân tích thông tin thị trường.
    *   **Quy trình**:
        *   Lắng nghe Kafka topic `news_raw`.
        *   Sử dụng mô hình **FinBERT** (ProsusAI/finbert) để phân tích cảm xúc (Tích cực/Tiêu cực/Trung lập).
        *   Sử dụng **Gemini API** cho các phân tích nhân quả hoặc chuyên sâu hơn.
        *   Đẩy kết quả vào Kafka topic `news_analyzed` và `ai_insights`.

6.  **Core Service** (Port 3001)
    *   **Nhiệm vụ**: Service trung tâm xử lý nghiệp vụ logic.
    *   **Quy trình**:
        *   Lắng nghe Kafka (`market_data`, `ai_insights`).
        *   Lưu trữ dữ liệu lịch sử và phân tích vào **TimescaleDB**.
        *   Cung cấp API cho Frontend để truy xuất dữ liệu lịch sử.

## 3. Cơ Chế Giao Tiếp (Communication Flow)

Hệ thống sử dụng kết hợp giữa giao tiếp đồng bộ (Synchronous) và bất đồng bộ (Asynchronous):

### Giao tiếp Bất đồng bộ (Async) - Data Pipeline
Luồng dữ liệu chính đi qua **Kafka**:
1.  **Dữ liệu Giá**: `Stream Service` -> Kafka (`market_data`) -> `Core Service` -> `TimescaleDB`.
2.  **Tin tức & AI**:
    *   `Crawler Service` -> Kafka (`news_raw`) -> `AI Service`.
    *   `AI Service` -> Phân tích -> Kafka (`news_analyzed`, `ai_insights`) -> `Core Service`.

### Giao tiếp Đồng bộ (Sync) - User Request
Luồng request từ người dùng (Frontend):
1.  **Frontend** gửi request đến `http://localhost:8000` (Kong Gateway).
2.  **Kong Gateway** định tuyến (dựa trên `kong.yml`) đến:
    *   `/auth` -> `Auth Service`
    *   `/api/v1/...` -> `Core Service`
    *   (Các route khác cấu hình trong Kong).

## 4. Cài Đặt & Chạy Dự Án

### Yêu cầu
*   Docker & Docker Compose
*   Node.js (cho development frontend local nếu cần)

### Các bước chạy
1.  **Cấu hình môi trường**:
    *   Đảm bảo file `.env` gốc có các biến cần thiết (ví dụ: `GEMINI_API_KEY`).

2.  **Khởi động hệ thống**:
    Chạy lệnh sau tại thư mục gốc:
    ```bash
    docker-compose up -d
    ```
    *Lệnh này sẽ khởi tạo tất cả databases, Kafka, Kong, và các services.*

3.  **Khởi tạo Kong Gateway**:
    Service `kong-init` sẽ tự động chạy để apply cấu hình từ `infra/kong_conf/kong.yml`.

4.  **Truy cập ứng dụng**:
    *   Web Client (Frontend): `http://localhost:5173`
    *   API Gateway: `http://localhost:8000`

## 5. Cấu trúc thư mục
```
infra/
├── docker-compose.yml    # File cấu hình Docker chính
├── kong.yml             # Cấu hình routes/services cho Kong
├── services/             # Source code các backend services
│   ├── ai-service/
│   ├── auth-service/
│   ├── core-service/
│   ├── crawler-service/
│   └── stream-service/
├── web-frontend/         # Source code React Frontend
└── infra/                # Các script/config hạ tầng bổ sung
```
