FROM node:latest
WORKDIR puppeteer
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
RUN echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list
RUN apt-get update && apt-get -y install chromium
COPY package.json .
RUN npm install
COPY index.js .
CMD ["node", "index.js"]