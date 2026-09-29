package main

import (
	"flag"
	"log"

	"rtk_cloud_admin/internal/store"
)

func main() {
	path := flag.String("database", "", "path to an isolated SQLite database")
	flag.Parse()
	if *path == "" {
		log.Fatal("--database is required")
	}
	s, err := store.Open(*path)
	if err != nil {
		log.Fatal(err)
	}
	defer s.Close()
	if err := s.ApplyMigrations(); err != nil {
		log.Fatal(err)
	}
}
