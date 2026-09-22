// schema-maintenance upgrades an existing SQLite database while all writers are stopped.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"rtk_cloud_admin/internal/store"
)

func main() {
	path := flag.String("database", os.Getenv("DATABASE_PATH"), "existing SQLite database path")
	flag.Parse()
	if *path == "" || flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: schema-maintenance --database PATH check|apply|verify")
		os.Exit(2)
	}
	if _, err := os.Stat(*path); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	s, err := store.Open(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer s.Close()
	switch flag.Arg(0) {
	case "check":
		var r store.SchemaMaintenanceReport
		r, err = s.CheckSchemaMaintenance()
		if err == nil {
			err = json.NewEncoder(os.Stdout).Encode(r)
			if err == nil && !r.Ready {
				err = fmt.Errorf("schema maintenance blocked by retained data")
			}
		}
	case "apply":
		err = s.ApplyMigrations()
		if err == nil {
			err = s.VerifySchemaMaintenance()
		}
	case "verify":
		err = s.VerifySchemaMaintenance()
	default:
		err = fmt.Errorf("unknown action")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
