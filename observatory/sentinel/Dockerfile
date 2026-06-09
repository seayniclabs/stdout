FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Make init script executable
RUN chmod +x scripts/init-ollama.sh 2>/dev/null || true

ENV HOST=0.0.0.0 PORT=8081 \
    OLLAMA_HOST=http://host.docker.internal:11434 \
    PROMETHEUS_URL=http://prometheus:9090 \
    LOKI_URL=http://loki:3100 \
    HELMSMAN_API_URL=http://host.docker.internal:5682 \
    CRITICAL_CHECK_INTERVAL=300 \
    PRODUCT_CHECK_INTERVAL=600 \
    DEFAULT_CHECK_INTERVAL=3600

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8081/health || exit 1

CMD ["/bin/sh", "-c", "if [ -f scripts/init-ollama.sh ]; then sh scripts/init-ollama.sh || true; fi && uvicorn main:app --host 0.0.0.0 --port 8081"]
