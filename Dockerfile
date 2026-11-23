FROM python:3.12-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends hackrf ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV RECORDINGS_DIR=/data/recordings PYTHONUNBUFFERED=1
EXPOSE 8073
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8073"]

# tests: fake hackrf_transfer, never the real radio
FROM base AS test
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests ./tests
COPY fake ./fake
CMD ["python", "-m", "pytest", "-q", "tests"]
