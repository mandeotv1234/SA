#!/usr/bin/env python3
"""
Generator: Đợi auth-service, lấy Public Key, format lại thụt đầu dòng
và inject vào kong.yml.template.
"""
import time
import requests
import sys
import textwrap
from pathlib import Path

# Cấu hình đường dẫn (tương thích với volume mapping .:/app trong Docker)
# Script nằm tại /app/infra/generate_kong_yml.py -> ROOT là /app
ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_FILE = ROOT / 'kong.yml.template'
OUT_DIR = ROOT / 'infra' / 'kong_conf'
OUT_FILE = OUT_DIR / 'kong.yml'

# Cấu hình API
AUTH_URL = 'http://auth-service:8080/auth/public-key'
TIMEOUT = 5
MAX_RETRIES = 30  # 30 lần x 2s = 60s chờ đợi tối đa

def log(msg):
    # flush=True để log hiện ngay lập tức trong Docker logs
    print(f"[kong-init] {msg}", flush=True)

def fetch_public_key():
    """Gọi API để lấy public key với cơ chế Retry"""
    log(f"Connecting to {AUTH_URL}...")
    
    for i in range(MAX_RETRIES):
        try:
            r = requests.get(AUTH_URL, timeout=TIMEOUT)
            if r.status_code == 200:
                key = r.text.strip()
                if "BEGIN PUBLIC KEY" in key:
                    log("Successfully fetched Public Key.")
                    return key
                else:
                    log("Warning: Response does not look like a PEM key.")
        except requests.exceptions.ConnectionError:
            pass # Service chưa up, bỏ qua
        except Exception as e:
            log(f"Error: {e}")

        log(f"Auth service not ready yet. Retrying ({i+1}/{MAX_RETRIES})...")
        time.sleep(2)
    
    log("CRITICAL: Could not fetch public key after multiple attempts.")
    sys.exit(1) # Thoát với mã lỗi để Docker biết

def format_pem_for_yaml(pem_string, indent_spaces=10):
    """
    Quan trọng: Thụt đầu dòng cho Public Key để hợp lệ cú pháp YAML.
    Mặc định thụt 10 spaces (phù hợp với cấu trúc file mẫu bên dưới).
    """
    # Dùng textwrap để thụt lề mọi dòng của key
    return textwrap.indent(pem_string, ' ' * indent_spaces)

def main():
    # 1. Đảm bảo thư mục output tồn tại
    if not OUT_DIR.exists():
        OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 2. Đọc template
    if not TEMPLATE_FILE.exists():
        log(f"Error: Template file not found at {TEMPLATE_FILE}")
        sys.exit(1)
    
    template_content = TEMPLATE_FILE.read_text()

    # 3. Lấy key
    raw_key = fetch_public_key()

    # 4. Xử lý Indentation (Fix lỗi YAML)
    # Lưu ý: indent_spaces=10 dựa trên cấu trúc file template bên dưới
    formatted_key = format_pem_for_yaml(raw_key, indent_spaces=10)

    # Do dòng đầu tiên của formatted_key đã có spaces, nhưng trong template 
    # placeholder thường nằm sau dấu | (xuống dòng).
    # Chúng ta cần trim spaces của dòng đầu tiên để nó nằm đúng vị trí con trỏ YAML,
    # HOẶC đơn giản là thay thế cả block.
    
    # Cách an toàn nhất: Xóa khoảng trắng đầu dòng đầu tiên (lstrip)
    # vì placeholder trong template đã được thụt lề sẵn rồi.
    final_key_block = formatted_key.lstrip()

    # 5. Render và Ghi file
    output_content = template_content.replace('REPLACE_WITH_AUTH_SERVICE_PUBLIC_KEY_PEM', final_key_block)
    
    OUT_FILE.write_text(output_content)
    log(f"Generated {OUT_FILE} successfully.")

if __name__ == '__main__':
    main()