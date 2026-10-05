FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY extraction.py runner.py cloud_runner.py embed_runner.py ./

RUN useradd --create-home --uid 10001 processor
USER processor

CMD ["python", "cloud_runner.py"]
