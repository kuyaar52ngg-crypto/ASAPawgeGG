# Build context = apps/worker
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY start.sh ./start.sh
EXPOSE 8000
# API:  uvicorn app.main:app      Queue worker:  arq app.worker.WorkerSettings  (see docker-compose.yml)
CMD ["sh", "start.sh"]
