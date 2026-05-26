FROM node:22-bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends pandoc jq make entr python3 \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install -g live-server

WORKDIR /work
