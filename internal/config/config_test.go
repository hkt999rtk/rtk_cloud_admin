package config

import "testing"

func TestFromEnvDefaultsAndOverrides(t *testing.T) {
	t.Setenv("PORT", "18081")
	t.Setenv("DATABASE_PATH", "data/test.db")
	t.Setenv("ACCOUNT_MANAGER_BASE_URL", "https://account.example")
	t.Setenv("VIDEO_CLOUD_BASE_URL", "https://video.example")
	t.Setenv("VIDEO_CLOUD_ADMIN_TOKEN", "video-admin-token")
	t.Setenv("ADMIN_BOOTSTRAP_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_BOOTSTRAP_PASSWORD", "secret")
	t.Setenv("ADMIN_BREAK_GLASS_ENABLED", "true")
	t.Setenv("LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED", "true")

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
	if cfg.AdminBootstrapEmail != "admin@example.com" || cfg.AdminBootstrapPassword != "secret" {
		t.Fatalf("admin bootstrap env not loaded")
	}
	if !cfg.AdminBreakGlassEnabled {
		t.Fatalf("AdminBreakGlassEnabled = false, want true")
	}
	if !cfg.LegacyCustomerPasswordLoginEnabled {
		t.Fatalf("LegacyCustomerPasswordLoginEnabled = false, want true")
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
	if cfg.AdminBreakGlassEnabled {
		t.Fatalf("AdminBreakGlassEnabled default = true, want false")
	}
	if cfg.LegacyCustomerPasswordLoginEnabled {
		t.Fatalf("LegacyCustomerPasswordLoginEnabled default = true, want false")
	}
}
