package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port                                string
	DatabasePath                        string
	AccountManagerBaseURL               string
	BillingServiceBaseURL               string
	BillingServiceToken                 string
	VideoCloudBaseURL                   string
	FactoryEnrollBaseURL                string
	Environment                         string
	DeveloperPKITestToolsEnabled        bool
	VideoCloudAdminToken                string
	VideoCloudPrometheusBaseURL         string
	GrafanaBaseURL                      string
	GrafanaDashboardPath                string
	CloudLoggerEndpoint                 string
	CloudLoggerToken                    string
	LogLevel                            string
	CustomerPasswordLoginEnabled        bool
	AccountManagerJobAuthorizationToken string
	BatchWorkerPollInterval             time.Duration
	BatchWorkerLeaseDuration            time.Duration
	ReportObjectStorageEndpoint         string
	ReportObjectStorageBucket           string
	ReportObjectStorageRegion           string
	ReportObjectStorageAccessKey        string
	ReportObjectStorageSecretKey        string
	RetireLegacyCustomerRoutes          bool
}

func FromEnv() Config {
	return Config{
		Port:                                getenv("PORT", "8080"),
		DatabasePath:                        getenv("DATABASE_PATH", filepath.Join("data", "rtk-cloud-admin.db")),
		AccountManagerBaseURL:               os.Getenv("ACCOUNT_MANAGER_BASE_URL"),
		BillingServiceBaseURL:               os.Getenv("BILLING_SERVICE_BASE_URL"),
		BillingServiceToken:                 os.Getenv("BILLING_SERVICE_TOKEN"),
		VideoCloudBaseURL:                   os.Getenv("VIDEO_CLOUD_BASE_URL"),
		FactoryEnrollBaseURL:                os.Getenv("FACTORY_ENROLL_BASE_URL"),
		Environment:                         strings.ToLower(getenv("CLOUD_ADMIN_ENV", "local")),
		DeveloperPKITestToolsEnabled:        truthy(os.Getenv("DEVELOPER_PKI_TEST_TOOLS_ENABLED")),
		VideoCloudAdminToken:                os.Getenv("VIDEO_CLOUD_ADMIN_TOKEN"),
		VideoCloudPrometheusBaseURL:         os.Getenv("VIDEO_CLOUD_PROMETHEUS_BASE_URL"),
		GrafanaBaseURL:                      os.Getenv("CLOUD_ADMIN_GRAFANA_BASE_URL"),
		GrafanaDashboardPath:                getenv("CLOUD_ADMIN_GRAFANA_DASHBOARD_PATH", "/d/rtk-lke-staging/rtk-lke-staging-overview"),
		CloudLoggerEndpoint:                 os.Getenv("CLOUD_LOGGER_ENDPOINT"),
		CloudLoggerToken:                    os.Getenv("CLOUD_LOGGER_INGEST_TOKEN"),
		LogLevel:                            getenv("CLOUD_ADMIN_LOG_LEVEL", getenv("LOG_LEVEL", "info")),
		CustomerPasswordLoginEnabled:        truthy(getenv("CUSTOMER_PASSWORD_LOGIN_ENABLED", "true")),
		AccountManagerJobAuthorizationToken: os.Getenv("ACCOUNT_MANAGER_JOB_AUTHORIZATION_TOKEN"),
		BatchWorkerPollInterval:             duration("BATCH_WORKER_POLL_INTERVAL", time.Second),
		BatchWorkerLeaseDuration:            duration("BATCH_WORKER_LEASE_DURATION", 30*time.Second),
		ReportObjectStorageEndpoint:         os.Getenv("REPORT_OBJECT_STORAGE_ENDPOINT"),
		ReportObjectStorageBucket:           os.Getenv("REPORT_OBJECT_STORAGE_BUCKET"),
		ReportObjectStorageRegion:           getenv("REPORT_OBJECT_STORAGE_REGION", "us-east-1"),
		ReportObjectStorageAccessKey:        os.Getenv("REPORT_OBJECT_STORAGE_ACCESS_KEY"),
		ReportObjectStorageSecretKey:        os.Getenv("REPORT_OBJECT_STORAGE_SECRET_KEY"),
		RetireLegacyCustomerRoutes:          truthy(getenv("RETIRE_LEGACY_CUSTOMER_ROUTES", "true")),
	}
}

func duration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err == nil && parsed > 0 {
		return parsed
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return fallback
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
