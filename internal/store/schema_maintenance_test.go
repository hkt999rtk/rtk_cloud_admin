package store

import (
	"reflect"
	"strings"
	"testing"
)

func TestSchemaMaintenanceRetainsUnreconciledLegacyData(t *testing.T) {
	s, err := Open(t.TempDir() + "/old.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, m := range migrations {
		if m.version < 11 {
			applyMigrationFixture(t, s, m)
		}
	}
	if _, err = s.db.Exec(`INSERT INTO platform_admins VALUES('old','old@example.com','hash','admin','now')`); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyMigrations(); err == nil {
		t.Fatal("deleted historical administrator without reconciliation")
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM platform_admins`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("lost historical rows: %d %v", count, err)
	}
	if _, err = s.db.Exec(`DELETE FROM platform_admins`); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyMigrations(); err != nil {
		t.Fatal(err)
	}
	if err = s.VerifySchemaMaintenance(); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaMaintenanceRefusesUnknownDependencies(t *testing.T) {
	for _, ddl := range []string{
		`CREATE VIEW unexpected_view AS SELECT * FROM upstream_devices`,
		`CREATE TABLE unexpected_child (id TEXT REFERENCES upstream_devices(id))`,
	} {
		t.Run(ddl, func(t *testing.T) {
			s, err := Open(t.TempDir() + "/old.db")
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			for _, m := range migrations {
				if m.version < 11 {
					applyMigrationFixture(t, s, m)
				}
			}
			if _, err := s.db.Exec(ddl); err != nil {
				t.Fatal(err)
			}
			report, err := s.CheckSchemaMaintenance()
			if err != nil || report.Ready || len(report.Blockers) != 1 {
				t.Fatalf("report=%+v error=%v", report, err)
			}
			if err := s.ApplyMigrations(); err == nil {
				t.Fatal("maintenance deleted a referenced table")
			}
			var version int
			if err := s.db.QueryRow(`SELECT max(version) FROM schema_migrations`).Scan(&version); err != nil || version != 10 {
				t.Fatalf("version=%d error=%v", version, err)
			}
		})
	}
}

func TestSchemaMaintenanceFreshAndUpgradedCatalogsMatch(t *testing.T) {
	fresh, err := Open(t.TempDir() + "/fresh.db")
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	if err := fresh.Migrate(); err != nil {
		t.Fatal(err)
	}
	upgraded, err := Open(t.TempDir() + "/upgraded.db")
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	for _, m := range migrations {
		if m.version < 11 {
			applyMigrationFixture(t, upgraded, m)
		}
	}
	if err := upgraded.ApplyMigrations(); err != nil {
		t.Fatal(err)
	}
	catalog := func(s *Store) []string {
		rows, err := s.db.Query(`SELECT type||':'||name||':'||COALESCE(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var result []string
		for rows.Next() {
			var entry string
			if err := rows.Scan(&entry); err != nil {
				t.Fatal(err)
			}
			result = append(result, entry)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	if got, want := catalog(upgraded), catalog(fresh); !reflect.DeepEqual(got, want) {
		t.Fatalf("upgraded catalog=%v, fresh=%v", got, want)
	}
	if _, err := upgraded.db.Exec(`CREATE TABLE platform_admins(id TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err := upgraded.Migrate(); err == nil {
		t.Fatal("restart accepted a resurrected retired table")
	}
}

func TestReadinessUniqueIndexSurvivesRetirement(t *testing.T) {
	s, err := Open(t.TempDir() + "/readiness.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, m := range migrations {
		if m.version < 11 {
			applyMigrationFixture(t, s, m)
		}
	}
	plan := func() string {
		var id, parent, unused int
		var detail string
		if err := s.db.QueryRow(`EXPLAIN QUERY PLAN SELECT * FROM readiness_facts WHERE device_id='fixture' AND layer='cloud'`).Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		return detail
	}
	t.Logf("before: %s", plan())
	if err := s.ApplyMigrations(); err != nil {
		t.Fatal(err)
	}
	after := plan()
	t.Logf("after: %s", after)
	if !strings.Contains(after, "sqlite_autoindex_readiness_facts_") {
		t.Fatalf("retained unique index not used: %s", after)
	}
	insert := `INSERT INTO readiness_facts(device_id,organization_id,layer,state,detail,source,fetched_at,updated_at) VALUES('fixture','org','cloud','ready','','fixture','now','now')`
	if _, err := s.db.Exec(insert); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(insert); err == nil {
		t.Fatal("duplicate device/layer accepted after index retirement")
	}
}

func TestSchemaMaintenanceExpiresLoginSessionsOnce(t *testing.T) {
	s, err := Open(t.TempDir() + "/sessions.db")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, m := range migrations {
		if m.version < 11 {
			applyMigrationFixture(t, s, m)
		}
	}
	insert := `INSERT INTO sessions VALUES('session','brand_cloud_user','old-user','old@example.com','access','refresh','cloud','later','now')`
	if _, err := s.db.Exec(insert); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyMigrations(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("old sessions=%d error=%v", count, err)
	}
	if _, err := s.db.Exec(insert); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("restart expired new session: count=%d error=%v", count, err)
	}
}
