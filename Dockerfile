FROM node:18-alpine

WORKDIR /app
COPY . .
RUN npm ci --only=production

RUN mkdir -p public/uploads

EXPOSE 9192

CMD ["npm", "start"]
