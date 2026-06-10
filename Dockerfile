FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY sample-data/ ./sample-data/

RUN sed -i 's/\r$//' /app/scripts/entrypoint.sh && chmod +x /app/scripts/entrypoint.sh

ENV DATA_DIR=/data
ENV CERT_DIR=/certs
EXPOSE 8000

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
