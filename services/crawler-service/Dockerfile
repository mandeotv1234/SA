FROM python:3.11-slim

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies required by some Python packages (librdkafka, lxml, build tools)
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
	   build-essential \
	   gcc \
	   librdkafka-dev \
	   libxml2-dev \
	   libxslt1-dev \
	   zlib1g-dev \
	   libssl-dev \
	   libffi-dev \
	   pkg-config \
	   ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]