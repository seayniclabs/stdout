FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir \
    fastapi==0.109.0 \
    uvicorn==0.27.0 \
    requests==2.31.0 \
    pyyaml==6.0.1 \
    websockets==12.0

# Copy application
COPY main.py /app/
COPY watcher.py /app/
COPY analyst.py /app/

EXPOSE 8081

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
