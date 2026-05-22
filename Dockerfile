FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=7860
ENV TZ=Asia/Kolkata
EXPOSE 7860

CMD ["node", "server.js"]