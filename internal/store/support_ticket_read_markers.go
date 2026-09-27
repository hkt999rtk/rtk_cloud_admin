package store

import (
	"database/sql"
	"time"
)

func (s *Store) SupportTicketSeenAt(actorID, scopeID string, ticketID int64) (string, error) {
	var seenAt string
	err := s.db.QueryRow(`SELECT seen_at FROM support_ticket_read_markers WHERE actor_id=? AND scope_id=? AND ticket_id=?`, actorID, scopeID, ticketID).Scan(&seenAt)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return seenAt, err
}

func (s *Store) MarkSupportTicketSeen(actorID, scopeID string, ticketID int64, seenAt string) error {
	if seenAt == "" {
		seenAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	_, err := s.db.Exec(`INSERT INTO support_ticket_read_markers(actor_id,scope_id,ticket_id,seen_at) VALUES(?,?,?,?)
ON CONFLICT(actor_id,scope_id,ticket_id) DO UPDATE SET seen_at=MAX(seen_at,excluded.seen_at)`, actorID, scopeID, ticketID, seenAt)
	return err
}
