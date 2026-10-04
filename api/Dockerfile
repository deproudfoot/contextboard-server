FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
