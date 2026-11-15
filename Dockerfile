# Both entrypoints reuse the same scientific dependencies to preserve interactive photometry.
FROM python:3.14-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/srv/backend \
    PORT=8080 SPHEREX_CACHE_DIR=/tmp/blink-cache BLINK_SERVE_PIXELS=false
WORKDIR /srv
COPY backend/requirements-cloud.txt /srv/backend/requirements-cloud.txt
RUN pip install --no-cache-dir -r backend/requirements-cloud.txt
COPY backend/spherex /srv/backend/spherex
COPY backend/cloud_app.py backend/orchestration_app.py backend/approved_sequences.json /srv/backend/
RUN useradd --system --uid 10001 blink
USER blink

FROM base AS api
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn cloud_app:app --app-dir backend --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]

# Detection continues to run in the existing browser worker. No Node runtime is needed by this job.
FROM base AS job
ENTRYPOINT ["python", "-m", "spherex.cloud_job"]
