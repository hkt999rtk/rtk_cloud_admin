FROM node:22-bookworm AS web

WORKDIR /src
COPY web/package*.json web/
RUN cd web && npm ci
COPY web web
RUN cd web && npm run build

FROM golang:1.26-bookworm AS builder

WORKDIR /src
COPY . .
COPY --from=web /src/web/dist /src/web/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /out/rtk-cloud-admin ./cmd/server

FROM debian:bookworm-slim

WORKDIR /app
RUN useradd -r -u 10001 app && chown app:app /app

COPY --from=builder /out/rtk-cloud-admin /app/rtk-cloud-admin
COPY --from=web /src/web/dist /app/web/dist

USER app
EXPOSE 8080
ENTRYPOINT ["/app/rtk-cloud-admin"]
