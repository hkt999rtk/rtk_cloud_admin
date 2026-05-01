package config

import "testing"

func TestFromEnvDefaultsAndOverrides(t *testing.T) {
	t.Setenv("PORT", "18081")
	t.Setenv("DATABASE_PATH", "data/test.db")
	t.Setenv("ACCOUNT_MANAGER_BASE_URL", "https://account.example")
	t.Setenv("VIDEO_CLOUD_BASE_URL", "https://video.example")
	t.Setenv("ADMIN_BOOTSTRAP_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_BOOTSTRAP_PASSWORD", "secret")

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
	if cfg.AdminBootstrapEmail != "admin@example.com" || cfg.AdminBootstrapPassword != "secret" {
		t.Fatalf("admin bootstrap env not loaded")
	}
}
