FROM golang:1.21-alpine AS builder
WORKDIR /app

# Copy module files and download dependencies
# (Ensure you have run 'go mod tidy' locally before building)
COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
# Build with CGO disabled for pure Go SQLite
RUN CGO_ENABLED=0 GOOS=linux go build -o apex-tunnel-server main.go

FROM alpine:latest
RUN apk add --no-cache ca-certificates libc6-compat tzdata
WORKDIR /app

COPY --from=builder /app/apex-tunnel-server .

# Create a directory to securely store Let's Encrypt certificates
RUN mkdir -p /app/certs

# Expose all necessary ports:
# 80, 443 : Agency Mode (Auto-TLS)
# 7000    : Internal FRPC WebSocket connections
# 8000    : Default PaaS Mode HTTP Port
EXPOSE 80 443 7000 8000 8080 8081

# Default command. Arguments/Env Vars control the mode.
CMD ["./apex-tunnel-server"]