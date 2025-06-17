FROM node:18-slim

ARG CHROME_VERSION="126.0.6478.182-1"

RUN apt-get update && apt-get install -y \
    ffmpeg \
    nano \
    zip unzip \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    chromium \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    wget \
    ca-certificates \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

RUN wget --no-verbose --no-check-certificate -O /tmp/chrome.deb https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb \
    && apt-get update \
    && apt install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production \
    && npm cache clean --force

COPY . .

EXPOSE 8443

CMD ["npm", "start"]