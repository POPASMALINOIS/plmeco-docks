FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --only=production
COPY server.js ./
# NOTA: no copiamos .env; docker-compose lo inyecta en runtime con env_file
EXPOSE 4000
CMD ["npm", "start"]
