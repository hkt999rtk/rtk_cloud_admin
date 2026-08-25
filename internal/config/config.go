package config

import (
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Port                         string
	DatabasePath                 string
	AccountManagerBaseURL        string
	BillingServiceBaseURL        string
	BillingServiceToken          string
	VideoCloudBaseURL            string
	FactoryEnrollBaseURL         string
	Environment                  string
	DeveloperPKITestToolsEnabled bool
	VideoCloudAdminToken         string
	VideoCloudPrometheusBaseURL  string
	GrafanaBaseURL               string
	GrafanaDashboardPath         string
	CloudLoggerEndpoint          string
	CloudLoggerToken             string
	LogLevel                     string
	CustomerPasswordLoginEnabled bool
}

func FromEnv() Config {
	return Config{
		Port:                         getenv("PORT", "8080"),
		DatabasePath:                 getenv("DATABASE_PATH", filepath.Join("data", "rtk-cloud-admin.db")),
		AccountManagerBaseURL:        os.Getenv("ACCOUNT_MANAGER_BASE_URL"),
		BillingServiceBaseURL:        os.Getenv("BILLING_SERVICE_BASE_URL"),
		BillingServiceToken:          os.Getenv("BILLING_SERVICE_TOKEN"),
		VideoCloudBaseURL:            os.Getenv("VIDEO_CLOUD_BASE_URL"),
		FactoryEnrollBaseURL:         os.Getenv("FACTORY_ENROLL_BASE_URL"),
		Environment:                  strings.ToLower(getenv("CLOUD_ADMIN_ENV", "local")),
		DeveloperPKITestToolsEnabled: truthy(os.Getenv("DEVELOPER_PKI_TEST_TOOLS_ENABLED")),
		VideoCloudAdminToken:         os.Getenv("VIDEO_CLOUD_ADMIN_TOKEN"),
		VideoCloudPrometheusBaseURL:  os.Getenv("VIDEO_CLOUD_PROMETHEUS_BASE_URL"),
		GrafanaBaseURL:               os.Getenv("CLOUD_ADMIN_GRAFANA_BASE_URL"),
		GrafanaDashboardPath:         getenv("CLOUD_ADMIN_GRAFANA_DASHBOARD_PATH", "/d/rtk-lke-staging/rtk-lke-staging-overview"),
		CloudLoggerEndpoint:          os.Getenv("CLOUD_LOGGER_ENDPOINT"),
		CloudLoggerToken:             os.Getenv("CLOUD_LOGGER_INGEST_TOKEN"),
		LogLevel:                     getenv("CLOUD_ADMIN_LOG_LEVEL", getenv("LOG_LEVEL", "info")),
		CustomerPasswordLoginEnabled: truthy(getenv("CUSTOMER_PASSWORD_LOGIN_ENABLED", "true")),
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
