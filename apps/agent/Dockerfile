FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent ./agent
COPY data ./data
COPY static ./static
# Cloud Run define PORT; localmente cai para 8080.
CMD ["sh", "-c", "uvicorn agent.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
