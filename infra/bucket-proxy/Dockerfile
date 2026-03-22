FROM oven/bun:1

WORKDIR /app

COPY package.json .
RUN bun install

COPY index.js .

EXPOSE 3000

CMD ["bun", "run", "index.js"]
