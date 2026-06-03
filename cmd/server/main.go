package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"rtk_cloud_admin/internal/app"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/store"

	cloudlogger "github.com/hkt999rtk/rtk_cloud_logger"
	"go.uber.org/zap"
)

func main() {
	cfg := config.FromEnv()
	logger := cloudlogger.MustNew(cloudlogger.Config{
		Service: "rtk-cloud-admin",
		Env:     getenv("ENV", "unknown"),
		Version: getenv("VERSION", "dev"),
		Level:   cfg.LogLevel,
	})
	defer logger.Sync()

	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		logger.Fatal("create data dir", zap.Error(err))
	}

	st, err := store.Open(cfg.DatabasePath)
	if err != nil {
		logger.Fatal("open store", zap.Error(err))
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		logger.Fatal("migrate store", zap.Error(err))
	}
	if err := st.SeedDemoData(); err != nil {
		logger.Fatal("seed demo data", zap.Error(err))
	}
	if err := st.BootstrapPlatformAdmin(cfg.AdminBootstrapEmail, cfg.AdminBootstrapPassword); err != nil {
		logger.Fatal("bootstrap platform admin", zap.Error(err))
	}

	handler := app.NewWithOptions(st, app.Options{Config: cfg, Logger: logger})
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("starting service", zap.String("addr", ":"+cfg.Port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("serve", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Warn("shutdown", zap.Error(err))
	}
}

func getenv(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
