# Zero-dependency Node server — no package installs needed, just the runtime.
FROM node:22-alpine

WORKDIR /app

# Copy everything the server serves or reads: rigrout.html, rigrout-server.js,
# the marker-cluster JS/CSS, manifest/icon/service-worker, and package.json.
# (.dockerignore keeps out node_modules, .git, .env, and the data/ directory —
# that last one is runtime-generated, not shipped.)
COPY . .

# Deployed containers need to accept traffic from outside themselves — see
# README "Deploying". Local `docker run` users can still override this with
# `-e HOST=127.0.0.1` if they only want it reachable from inside the container
# network, but 0.0.0.0 is the only setting that makes sense as a *container*
# default, since "the container's own loopback" isn't reachable from the host
# or a cloud platform's router either way.
ENV HOST=0.0.0.0
ENV PORT=3001

EXPOSE 3001

CMD ["node", "rigrout-server.js"]
