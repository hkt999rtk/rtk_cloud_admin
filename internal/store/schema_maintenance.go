package store

import (
	"database/sql"
	"fmt"
	"regexp"
)

type SchemaMaintenanceReport struct {
	Version       int            `json:"version"`
	TargetVersion int            `json:"target_version"`
	Ready         bool           `json:"ready"`
	Rows          map[string]int `json:"retired_table_rows"`
	Blockers      []string       `json:"blockers,omitempty"`
}

type schemaQueryer interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func (s *Store) CheckSchemaMaintenance() (SchemaMaintenanceReport, error) {
	return checkSchemaMaintenance(s.db)
}

func checkSchemaMaintenance(db schemaQueryer) (SchemaMaintenanceReport, error) {
	r := SchemaMaintenanceReport{TargetVersion: 11, Ready: true, Rows: map[string]int{}}
	var exists int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&exists); err != nil {
		return r, err
	}
	if exists != 0 {
		if err := db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_migrations`).Scan(&r.Version); err != nil {
			return r, err
		}
	}
	for _, name := range []string{"platform_admins", "upstream_organizations", "upstream_devices", "upstream_operations"} {
		if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&exists); err != nil {
			return r, err
		}
		if exists == 0 {
			continue
		}
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM ` + name).Scan(&n); err != nil {
			return r, err
		}
		r.Rows[name] = n
		if n != 0 {
			r.Ready = false
		}
	}
	if r.Version > r.TargetVersion {
		r.Blockers = append(r.Blockers, "database schema is newer than this binary")
	}
	rows, err := db.Query(`SELECT type,name,COALESCE(sql,'') FROM sqlite_master WHERE type IN ('view','trigger','table') ORDER BY name`)
	if err != nil {
		return r, err
	}
	retired := regexp.MustCompile(`(?i)\b(platform_admins|upstream_organizations|upstream_devices|upstream_operations)\b`)
	type object struct{ kind, name, ddl string }
	objects := []object{}
	for rows.Next() {
		var o object
		if err := rows.Scan(&o.kind, &o.name, &o.ddl); err != nil {
			rows.Close()
			return r, err
		}
		objects = append(objects, o)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return r, err
	}
	rows.Close()
	for _, o := range objects {
		if o.kind == "table" && retired.MatchString(o.name) {
			continue
		}
		if retired.MatchString(o.ddl) {
			r.Blockers = append(r.Blockers, fmt.Sprintf("%s %s references a retired table", o.kind, o.name))
		}
	}
	if len(r.Blockers) > 0 {
		r.Ready = false
	}
	return r, nil
}

func (s *Store) VerifySchemaMaintenance() error {
	r, err := s.CheckSchemaMaintenance()
	if err != nil {
		return err
	}
	if r.Version != r.TargetVersion || len(r.Rows) != 0 || !r.Ready {
		return fmt.Errorf("schema maintenance incomplete: version=%d remaining=%v", r.Version, r.Rows)
	}
	var n int
	if err = s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_readiness_facts_device'`).Scan(&n); err != nil {
		return err
	}
	if n != 0 {
		return fmt.Errorf("redundant readiness index remains")
	}
	return nil
}
