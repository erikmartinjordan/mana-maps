FROM node:22-bookworm-slim

RUN apt-get update  && apt-get install -y --no-install-recommends ca-certificates git python3 openssh-client procps lsof psmisc curl     libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2     libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3     libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0     libx11-6 libxcb1 libxext6 libglib2.0-0 libgdk-pixbuf-2.0-0 libx11-xcb1     fonts-liberation libu2f-udev libvulkan1 xdg-utils  && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai --no-audit --no-fund  && rm -rf /root/.npm

WORKDIR /home/erik
ENV HOME=/home/erik
