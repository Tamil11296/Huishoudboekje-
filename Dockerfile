# ---- stap 1: frontend bouwen ----
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive --network-timeout 600000
COPY frontend/ ./
RUN yarn build

# ---- stap 2: backend + gebouwde frontend in één container ----
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/build ./static
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser
EXPOSE 8080
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
