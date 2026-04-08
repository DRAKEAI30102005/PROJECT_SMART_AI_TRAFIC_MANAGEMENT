FROM node:20-bullseye

ENV PYTHONUNBUFFERED=1
ENV PYTHON_BIN=python3
ENV PORT=7860
ENV DETECTOR_WORKERS=2
ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV NUMEXPR_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python-is-python3 \
    python3-pip \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY ml/requirements.txt ./ml/requirements.txt
RUN pip3 install --no-cache-dir -r ml/requirements.txt

COPY . .

RUN npm run build

EXPOSE 7860

CMD ["npm", "run", "start"]
