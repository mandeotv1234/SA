# BÁO CÁO CHỨC NĂNG DỰ ÁN HỆ THỐNG HỖ TRỢ GIAO DỊCH (TRADE AI)

Dưới đây là tổng hợp chi tiết các chức năng đã thực hiện của dự án, bao gồm các tính năng cốt lõi và các tính năng nâng cao mà nhóm đã phát triển.

## 1. Hiển thị Biểu đồ và Dữ liệu Giá (Real-time Data Visualization)
Hệ thống cung cấp giao diện theo dõi thị trường trực quan với khả năng cập nhật thời gian thực.

- **Kết nối WebSocket:** Sử dụng kết nối WebSocket trực tiếp (qua Stream Service) để nhận dữ liệu giá từ sàn Binance với độ trễ cực thấp (< 100ms).
- **Biểu đồ đa khung thời gian:** Tích hợp thư viện `lightweight-charts` cho phép hiển thị biểu đồ nến (Candlestick) mượt mà trên nhiều khung thời gian (15m, 1h, 4h, 1D).
- **Chỉ báo phân tích kỹ thuật (Technical Indicators):** Sẵn sàng các công cụ phân tích phổ biến được tính toán tự động:
  - Đường trung bình động: SMA, EMA (12, 26, 50, 200).
  - Dải Bollinger Bands (BB).
  - Chỉ báo động lượng: RSI, MACD.
- **Trải nghiệm người dùng:** Hỗ trợ Zoom, Pan, và Switch theme (Dark/Light mode) linh hoạt.

## 2. Thu thập và Phân Tích Tin Tức (News Crawling & Sentiment Analysis)
Hệ thống tự động thu thập và xử lý thông tin từ các nguồn tài chính uy tín để hỗ trợ ra quyết định.

- **Crawler Engine:** Service chuyên biệt tự động quét tin tức từ các trang báo tài chính, diễn đàn Crypto liên tục 24/7.
- **Xử lý trùng lặp:** Cơ chế thông minh loại bỏ các bài viết trùng lặp hoặc spam spam.
- **Phân tích cảm xúc (Sentiment Analysis):**
  - Sử dụng mô hình AI để đọc hiểu nội dung bài viết.
  - Đánh giá và gán nhãn cảm xúc: **Tích cực (Positive)**, **Tiêu cực (Negative)**, hoặc **Trung lập (Neutral)**.
  - Chấm điểm tác động (Impact Score) của tin tức đối với thị trường.
- **Hiển thị thông minh:** Tin tức được hiển thị real-time trên Dashboard kèm theo nhãn màu cảm xúc giúp người dùng nắm bắt xu hướng nhanh chóng.

## 3. Kiểm Thử Chiến Lược Đầu Tư (Advanced Backtesting System)
Module cho phép người dùng kiểm chứng hiệu quả của chiến lược giao dịch trên dữ liệu quá khứ trước khi mạo hiểm tiền thật.

- **Strategy Builder (Xây dựng chiến thuật):** Giao diện trực quan cho phép người dùng tự định nghĩa quy tắc giao dịch mà không cần code:
  - Điều kiện Indicator (VD: RSI < 30 AND Price > EMA200).
  - Điều kiện AI (VD: AI Prediction = UP).
  - Điều kiện Tin tức (VD: Sentiment Score > 0.5).
- **Simulation Engine (Bộ máy giả lập):**
  - Chạy mô phỏng trên dữ liệu lịch sử (Historical Data) chính xác từng cây nến.
  - Tính toán lợi nhuận (PnL), sụt giảm tài khoản (Drawdown), phí giao dịch giả định.
- **Báo cáo hiệu suất:** Xuất ra các chỉ số quan trọng: ROI (Return on Investment), Win Rate (Tỷ lệ thắng), Profit Factor, Max Drawdown. Biểu đồ đường cong vốn (Equity Curve).

## 4. Quản Lý Tài Khoản, Phân Quyền & Thanh Toán
Hệ thống quản lý người dùng bảo mật và tích hợp cổng thanh toán tự động.

- **Authentication & Security:**
  - Đăng ký/Đăng nhập bảo mật với JWT (JSON Web Token).
  - Bảo vệ API bằng **Kong API Gateway** (Rate limiting, IP restriction).
  - Mã hóa mật khẩu an toàn.
- **Phân cấp người dùng (Authorization):**
  - Cơ chế phân quyền: Guest, Member, VIP, Admin.
  - Trang Admin Dashboard riêng biệt để quản lý người dùng.
- **Cổng thanh toán tự động (SePay Integration):**
  - Tích hợp thanh toán qua QR Code ngân hàng.
  - Hệ thống tự động kích hoạt gói VIP ngay lập tức khi nhận được tiền (Webhook xử lý realtime).

## 5. Mô Phỏng Đầu Tư (Investment Simulation)
Module cho phép người dùng học và trải nghiệm đầu tư mà không cần vốn thực, giúp xây dựng kiến thức tài chính an toàn.

- **Portfolio Management (Quản lý danh mục):**
  - Tạo danh mục đầu tư ảo với số vốn giả định.
  - Mua bán (Long/Short) các cặp tiền điện tử theo giá thị trường thực tế (Real-time Market Price).
  - Theo dõi biến động tài sản (Asset Allocation), Lãi/Lỗ (PnL) theo thời gian thực.
- **Transaction History (Lịch sử giao dịch):**
  - Ghi lại chi tiết thời gian, giá khớp lệnh, phí giao dịch của từng lệnh Mua/Bán.
  - Tính toán chính xác giá trung bình (Average Price) khi mua nhiều lần.
- **Leaderboard (Bảng xếp hạng):**
  - So sánh hiệu suất đầu tư giữa các người dùng (Top Investors).
  - Khuyến khích cạnh tranh và học hỏi chiến lược từ những người chơi giỏi nhất.

## 6. Các Tính Năng Nâng Cao & Tâm Đắc
Ngoài các chức năng cơ bản, nhóm tập trung phát triển sâu các tính năng công nghệ để tạo lợi thế cạnh tranh:

### 🌟 1. AI Cải Tiến: Hệ Thống Dự Đoán Đa Chiều (Advanced Dual-Stream Network)
Nhóm đã phát triển một kiến trúc Deep Learning chuyên biệt (**AdvancedDualStreamNetwork**) thay vì chỉ sử dụng các mô hình có sẵn, thể hiện sự đầu tư sâu về thuật toán:

- **Kiến Trúc Dual-Stream Độc Đáo:**
  - Hệ thống xử lý song song hai luồng dữ liệu độc lập: **Price Stream** (Dữ liệu giá) và **News Stream** (Dữ liệu tin tức), sau đó hợp nhất (Fusion) để đưa ra quyết định.
  - **Luồng Giá (Price Stream):** Kết hợp sức mạnh của **Bi-LSTM** (3 layers) để nắm bắt xu hướng ngắn hạn và **Transformer Encoder** (2 layers, 8 heads) để học các phụ thuộc dài hạn (Long-range dependencies) từ chuỗi 60 nến lịch sử.
  - **Luồng Tin Tức (News Stream):** Sử dụng **FinBERT Embeddings** (768 dimensions) để vector hóa nội dung tin tức, áp dụng **Multi-Head Attention** để lọc ra những tin tức có trọng số tác động lớn nhất trong khung thời gian.

- **Cơ Chế Fusion & Cross-Attention:**
  - Áp dụng kỹ thuật **Cross-Modal Attention**, cho phép mô hình giá "nhìn" sang dữ liệu tin tức để điều chỉnh dự đoán (ví dụ: Giá có tín hiệu giảm nhưng tin tức rất tốt -> Model điều chỉnh lại xác suất).
  - Tích hợp **Coin Embeddings** để mô hình học được đặc tính riêng biệt (Độ biến động, thanh khoản) của từng cặp coin (BTC khác ETH).

- **Huấn Luyện Đa Mục Tiêu (Multi-Horizon Training):**
  - Model không chỉ dự đoán một giá trị mà tối ưu hóa đồng thời nhiều mục tiêu qua hàm **MultiHorizonLoss**:
    *   Dự đoán xu hướng (Direction Classfication: UP/DOWN).
    *   Dự đoán biên độ giá (% Return Regression).
    *   Dự đoán độ biến động (Volatility Classification: LOW/MED/HIGH).
  - Quá trình training sử dụng **AdamW Optimizer** và cơ chế **Learning Rate Scheduling** tự động điều chỉnh để đạt điểm hội tụ tốt nhất.

### 🌟 2. Hệ Thống Backtesting Đa Chỉ Báo & Linh Hoạt
Không chỉ kiểm thử MA cắt nhau đơn giản, module Backtest được xây dựng như một engine mạnh mẽ:
- **Đa dạng Chỉ báo:** Hỗ trợ kết hợp đồng thời nhiều chỉ báo: RSI, MACD, Bollinger Bands, EMA/SMA, Volume.
- **Logic Phức tạp:** Cho phép người dùng thiết lập các điều kiện lồng nhau (AND/OR), chốt lời (Take Profit), cắt lỗ (Stop Loss) động.
- **Tối ưu hóa:** Engine giả lập chạy trên Backend với thuật toán tối ưu, xử lý hàng triệu cây nến lịch sử chỉ trong vài giây.

### 🌟 3. Kiến Trúc Microservices & Scalability (Khả năng Mở rộng)
Hệ thống được thiết kế để chịu tải lớn và dễ dàng mở rộng theo chiều ngang:
- **Tách biệt dịch vụ:** Core Service, Auth Service, AI Service, Crawler Service chạy độc lập. Nếu một service gặp sự cố, các service khác vẫn hoạt động bình thường (Fault Isolation).
- **Load Balancer (Cân bằng tải):**
  - Sử dụng **HAProxy** làm lớp cân bằng tải đầu vào (L4/L7 Load Balancing), phân phối traffic hiệu quả và đảm bảo tính sẵn sàng cao (High Availability).
  - Kết hợp **Kong API Gateway** để quản lý API, Rate Limiting và Auth.
- **High Availability:** Các service stateless có thể scale lên nhiều instance dễ dàng bẳng Docker Swarm hoặc K8s. HAProxy giúp điều phối traffic thông minh khi có sự cố instance.

### 🌟 4. Xử Lý Dữ Liệu Thời Gian Thực & WebSocket Hiệu Năng Cao
Đảm bảo trải nghiệm "Real-time" đúng nghĩa cho người dùng giao dịch:
- **Kiến Trúc Ingester-Stream:**
  - Tách biệt **Ingester Service** (chuyên nhận và chuẩn hóa dữ liệu tốc độ cao từ Binance) và **Stream Service** (chuyên đẩy dữ liệu xuống Client).
  - Giúp hệ thống xử lý hàng nghìn thay đổi giá mỗi giây (Ticks) mà không ảnh hưởng đến hiệu năng phản hồi người dùng.
- **Redis Pub/Sub & Caching:**
  - Sử dụng **Redis Pub/Sub** làm lớp trung chuyển siêu tốc (Message Broker) giữa Ingester và cụm Stream Service.
  - Đảm bảo dữ liệu được broadcast đồng thời tới tất cả các node server với độ trễ gần như bằng 0.
- **WebSocket Cluster:**
  - Hệ thống Socket.IO được cấu hình chạy trên nhiều node (Cluster Mode) với **Redis Adapter**.
  - Cho phép mở rộng (Scale-out) không giới hạn số lượng kết nối đồng thời (CCU) mà vẫn đảm bảo tính toàn vẹn dữ liệu.
- **Data Pipeline:**
  - Kết hợp sức mạnh của **Kafka** (cho dữ liệu lịch sử/phân tích bền vững) và **Redis** (cho dữ liệu nóng realtime), tạo nên luồng dữ liệu (Data Flow) tối ưu nhất về tốc độ lẫn độ tin cậy.

### 🌟 5. Hệ Thống Thanh Toán & Thông Báo Tự Động
Khép kín quy trình vận hành doanh nghiệp:
- **Payment Automation:** Tích hợp SePay/Banking, tự độngn nhận diện giao dịch chuyển khoản, verify nội dung và kích hoạt gói dịch vụ (VIP) trong tích tắc mà không cần nhân viên check tay.
- **Notification System:** Hệ thống thông báo đa kênh (Email SMTP, Notification đẩy App/Web) giúp người dùng không bỏ lỡ tin tức quan trọng hoặc cảnh báo bảo mật.

---
*Báo cáo được trích xuất từ mã nguồn dự án TradeAI.*
