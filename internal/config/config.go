package config

import (
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Port                               string
	DatabasePath                       string
	AccountManagerBaseURL              string
	VideoCloudBaseURL                  string
	VideoCloudAdminToken               string
	VideoCloudPrometheusBaseURL        string
	CloudLoggerEndpoint                string
	CloudLoggerToken                   string
	AdminBootstrapEmail                string
	AdminBootstrapPassword             string
	AdminBreakGlassEnabled             bool
	LegacyCustomerPasswordLoginEnabled bool
}

func FromEnv() Config {
	return Config{
		Port:                               getenv("PORT", "8080"),
		DatabasePath:                       getenv("DATABASE_PATH", filepath.Join("data", "rtk-cloud-admin.db")),
		AccountManagerBaseURL:              os.Getenv("ACCOUNT_MANAGER_BASE_URL"),
		VideoCloudBaseURL:                  os.Getenv("VIDEO_CLOUD_BASE_URL"),
		VideoCloudAdminToken:               os.Getenv("VIDEO_CLOUD_ADMIN_TOKEN"),
		VideoCloudPrometheusBaseURL:        os.Getenv("VIDEO_CLOUD_PROMETHEUS_BASE_URL"),
		CloudLoggerEndpoint:                os.Getenv("CLOUD_LOGGER_ENDPOINT"),
		CloudLoggerToken:                   os.Getenv("CLOUD_LOGGER_INGEST_TOKEN"),
		AdminBootstrapEmail:                os.Getenv("ADMIN_BOOTSTRAP_EMAIL"),
		AdminBootstrapPassword:             os.Getenv("ADMIN_BOOTSTRAP_PASSWORD"),
		AdminBreakGlassEnabled:             truthy(os.Getenv("ADMIN_BREAK_GLASS_ENABLED")),
		LegacyCustomerPasswordLoginEnabled: truthy(os.Getenv("LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED")),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "t", "yes", "y", "on":
		return true
	default:
		return false
	}
}
