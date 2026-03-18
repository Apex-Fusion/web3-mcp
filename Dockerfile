FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY build/ ./build/
EXPOSE 3000
CMD ["node", "build/index.js"]
