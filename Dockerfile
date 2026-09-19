FROM node:18-slim

WORKDIR /app

# Install dependencies first (cache layer — only re-runs when package.json changes)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
