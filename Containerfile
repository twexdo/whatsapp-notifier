FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends systemd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src

CMD ["npm", "start"]