package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"rtk_cloud_admin/internal/app"
	"rtk_cloud_admin/internal/config"
	"rtk_cloud_admin/internal/store"
)

func main() {
	cfg := config.FromEnv()

	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	st, err := store.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(); err != nil {
		log.Fatalf("migrate store: %v", err)
	}
	if err := st.SeedDemoData(); err != nil {
		log.Fatalf("seed demo data: %v", err)
	}
	if err := st.BootstrapPlatformAdmin(cfg.AdminBootstrapEmail, cfg.AdminBootstrapPassword); err != nil {
		log.Fatalf("bootstrap platform admin: %v", err)
	}

	handler := app.NewWithOptions(st, app.Options{Config: cfg})
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("rtk cloud admin listening on http://localhost:%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
