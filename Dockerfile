FROM node:16 AS ui-build
WORKDIR /usr/src/app
COPY package.json yarn.lock tsconfig.json  ./
RUN yarn
COPY ./src src
COPY ./public public
RUN yarn build
EXPOSE 3000
CMD ["yarn",  "start"]