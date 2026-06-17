package config

import "testing"

func TestFromEnvDefaultsAndOverrides(t *testing.T) {
	t.Setenv("PORT", "18081")
	t.Setenv("DATABASE_PATH", "data/test.db")
	t.Setenv("ACCOUNT_MANAGER_BASE_URL", "https://account.example")
	t.Setenv("VIDEO_CLOUD_BASE_URL", "https://video.example")
	t.Setenv("VIDEO_CLOUD_ADMIN_TOKEN", "video-admin-token")
	t.Setenv("VIDEO_CLOUD_PROMETHEUS_BASE_URL", "http://10.42.1.30:9090")
	t.Setenv("CLOUD_ADMIN_GRAFANA_BASE_URL", "http://grafana.observability.svc.cluster.local:3000")
	t.Setenv("CLOUD_ADMIN_GRAFANA_DASHBOARD_PATH", "/d/custom/custom-dashboard")
	t.Setenv("CLOUD_ADMIN_LOG_LEVEL", "warn")
	t.Setenv("CUSTOMER_PASSWORD_LOGIN_ENABLED", "true")

	cfg := FromEnv()
	if cfg.Port != "18081" {
		t.Fatalf("Port = %q, want 18081", cfg.Port)
	}
	if cfg.DatabasePath != "data/test.db" {
		t.Fatalf("DatabasePath = %q, want data/test.db", cfg.DatabasePath)
	}
	if cfg.AccountManagerBaseURL != "https://account.example" {
		t.Fatalf("AccountManagerBaseURL = %q", cfg.AccountManagerBaseURL)
	}
	if cfg.VideoCloudBaseURL != "https://video.example" {
		t.Fatalf("VideoCloudBaseURL = %q", cfg.VideoCloudBaseURL)
	}
	if cfg.VideoCloudAdminToken != "video-admin-token" {
		t.Fatalf("VideoCloudAdminToken = %q", cfg.VideoCloudAdminToken)
	}
	if cfg.VideoCloudPrometheusBaseURL != "http://10.42.1.30:9090" {
		t.Fatalf("VideoCloudPrometheusBaseURL = %q", cfg.VideoCloudPrometheusBaseURL)
	}
	if cfg.GrafanaBaseURL != "http://grafana.observability.svc.cluster.local:3000" {
		t.Fatalf("GrafanaBaseURL = %q", cfg.GrafanaBaseURL)
	}
	if cfg.GrafanaDashboardPath != "/d/custom/custom-dashboard" {
		t.Fatalf("GrafanaDashboardPath = %q", cfg.GrafanaDashboardPath)
	}
	if cfg.LogLevel != "warn" {
		t.Fatalf("LogLevel = %q, want warn", cfg.LogLevel)
	}
	if !cfg.CustomerPasswordLoginEnabled {
		t.Fatalf("CustomerPasswordLoginEnabled = false, want true")
	}
}

func TestFromEnvDefaults(t *testing.T) {
	cfg := FromEnv()
	if cfg.Port != "8080" {
		t.Fatalf("Port default = %q, want 8080", cfg.Port)
	}
	if cfg.DatabasePath != "data/rtk-cloud-admin.db" {
		t.Fatalf("DatabasePath default = %q", cfg.DatabasePath)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel default = %q, want info", cfg.LogLevel)
	}
	if !cfg.CustomerPasswordLoginEnabled {
		t.Fatalf("CustomerPasswordLoginEnabled default = false, want true")
	}
	if cfg.GrafanaDashboardPath != "/d/rtk-lke-staging/rtk-lke-staging-overview" {
		t.Fatalf("GrafanaDashboardPath default = %q", cfg.GrafanaDashboardPath)
	}
}
