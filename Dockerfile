# ElectionTrace — app only. Sample media is included so the image boots.
# Mount your own extract at /app/media to use the national files.
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY media/README.md ./media/README.md
COPY media/sample ./media/sample

ENV PORT=5200 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 5200
CMD ["node", "app/server.mjs"]
