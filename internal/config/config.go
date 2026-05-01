package config

import (
	"os"
	"path/filepath"
)

type Config struct {
	Port                   string
	DatabasePath           string
	AccountManagerBaseURL  string
	VideoCloudBaseURL      string
	AdminBootstrapEmail    string
	AdminBootstrapPassword string
}

func FromEnv() Config {
	return Config{
		Port:                   getenv("PORT", "8080"),
		DatabasePath:           getenv("DATABASE_PATH", filepath.Join("data", "rtk-cloud-admin.db")),
		AccountManagerBaseURL:  os.Getenv("ACCOUNT_MANAGER_BASE_URL"),
		VideoCloudBaseURL:      os.Getenv("VIDEO_CLOUD_BASE_URL"),
		AdminBootstrapEmail:    os.Getenv("ADMIN_BOOTSTRAP_EMAIL"),
		AdminBootstrapPassword: os.Getenv("ADMIN_BOOTSTRAP_PASSWORD"),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
