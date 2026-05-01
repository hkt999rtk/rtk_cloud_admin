FROM node:22-alpine AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS backend
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web/dist ./web/dist
RUN go build -o /out/rtk-cloud-admin ./cmd/server

FROM alpine:3.21
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown -R app:app /data
COPY --from=backend /out/rtk-cloud-admin /app/rtk-cloud-admin
COPY --from=frontend /src/web/dist /app/web/dist
ENV PORT=8080
ENV DATABASE_PATH=/data/rtk-cloud-admin.db
EXPOSE 8080
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["/app/rtk-cloud-admin"]
