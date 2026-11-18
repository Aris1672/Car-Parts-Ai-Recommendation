FROM node:20-slim

WORKDIR /app

# Install dependencies first (cache layer — only re-runs when package.json changes)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Playwright is used only for the controlled ABCP login bootstrap. Install
# Chromium and its Debian runtime libraries into the image; no browser worker
# is enabled by default at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client \
  && rm -rf /var/lib/apt/lists/*
RUN npx playwright install --with-deps chromium

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY scripts/start-with-abcp-tunnel.sh /usr/local/bin/start-with-abcp-tunnel.sh
RUN chmod 755 /usr/local/bin/start-with-abcp-tunnel.sh

CMD ["/usr/local/bin/start-with-abcp-tunnel.sh"]
