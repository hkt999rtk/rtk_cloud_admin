FROM node:22-bookworm AS web

WORKDIR /src
COPY web/package*.json web/
RUN cd web && npm ci
COPY web web
COPY internal/app internal/app
COPY internal/readinessfacts internal/readinessfacts
RUN cd web && npm run build

FROM golang:1.26-bookworm AS builder

WORKDIR /src
COPY . .
COPY --from=web /src/web/dist /src/web/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/schema-maintenance ./cmd/schema-maintenance
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/rtk-cloud-admin ./cmd/server

FROM debian:bookworm-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 app \
    && chown app:app /app

COPY --from=builder /out/schema-maintenance /app/schema-maintenance
COPY --from=builder /out/rtk-cloud-admin /app/rtk-cloud-admin
COPY --from=web /src/web/dist /app/web/dist

USER app
EXPOSE 8080
ENTRYPOINT ["/app/rtk-cloud-admin"]
