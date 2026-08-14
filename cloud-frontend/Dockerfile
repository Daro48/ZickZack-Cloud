FROM node:22-alpine

WORKDIR /app

COPY ./frontend/package*.json /app/
RUN npm install

COPY ./frontend/ /app/

EXPOSE 5173

# Lokal (Dev): diese CMD aktiv lassen, Server-Block auskommentiert lassen
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Server (Build + Preview): Dev-CMD auskommentieren und diese beiden Zeilen aktivieren
# RUN npm run build
# CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]