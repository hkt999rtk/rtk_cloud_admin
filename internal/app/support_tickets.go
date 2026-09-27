package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"rtk_cloud_admin/internal/store"
	"rtk_cloud_admin/internal/zammadclient"
	"strconv"
	"strings"
	"time"
)

const supportRoot = "/api/developer/brand-clouds/{brandCloudID}/support/tickets"

var supportNumericID = regexp.MustCompile(`^[1-9][0-9]{0,17}$`)
var supportHTMLTag = regexp.MustCompile(`<[^>]*>`)
var errSupportAgentNotProvisioned = errors.New("support agent is not provisioned in Zammad")

type supportActor struct {
	ID           string
	Email        string
	Name         string
	Role         string
	CloudID      string
	Capabilities []string
	Session      store.Session
}

type supportInput struct {
	Title      string              `json:"title"`
	Body       string              `json:"body"`
	Category   string              `json:"category"`
	Visibility string              `json:"visibility"`
	Files      []zammadclient.File `json:"-"`
}

func (s *Server) supportTicketRoutes() {
	s.mux.HandleFunc("GET /api/admin/support/agents", s.supportAgents)
	register := func(method, suffix string, handler http.HandlerFunc) {
		s.mux.HandleFunc(method+" "+supportRoot+suffix, scopedCustomer(handler))
		s.mux.HandleFunc(method+" /api/admin/support/tickets"+suffix, handler)
	}
	register("GET", "", s.supportList)
	register("POST", "", s.supportCreate)
	register("GET", "/{ticketID}", s.supportDetail)
	register("POST", "/{ticketID}/articles", s.supportReply)
	register("PATCH", "/{ticketID}", s.supportPatch)
	register("POST", "/{ticketID}/seen", s.supportSeen)
	register("GET", "/{ticketID}/articles/{articleID}/attachments/{attachmentID}", s.supportAttachment)
}

func (s *Server) supportAgents(w http.ResponseWriter, r *http.Request) {
	_, ok := s.supportAuthorize(w, r, "reassign")
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 80 {
		http.Error(w, "Search is too long", http.StatusBadRequest)
		return
	}
	search := query
	if search == "" {
		search = "rtk-"
	}
	users, err := s.zammadClient.SearchUsers(r.Context(), search)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(users))
	for _, user := range users {
		if !strings.HasPrefix(user.Login, "rtk-") || !hasCapability(user.Roles, "Agent") {
			continue
		}
		items = append(items, map[string]any{"id": user.ID, "name": strings.TrimSpace(user.Firstname + " " + user.Lastname), "email": user.Email})
	}
	writeJSON(w, map[string]any{"items": items})
}

func (s *Server) supportReady(w http.ResponseWriter) bool {
	if !s.cfg.SupportTicketsEnabled || !s.accountClient.Enabled() || !s.zammadClient.Enabled() || s.cfg.ZammadSupportGroupID <= 0 {
		http.Error(w, "Support tickets are unavailable", http.StatusServiceUnavailable)
		return false
	}
	return true
}

func (s *Server) supportAuthorize(w http.ResponseWriter, r *http.Request, permission string) (supportActor, bool) {
	if !s.supportReady(w) {
		return supportActor{}, false
	}
	if explicitCustomerScope(r.Context()) != "" {
		session, ok := s.customerSession(r)
		if !ok {
			http.Error(w, "Customer sign-in required", http.StatusUnauthorized)
			return supportActor{}, false
		}
		org, _, err := s.activeCustomerOrg(r.Context(), session)
		if err != nil {
			if errors.Is(err, errCustomerActiveOrgInvalid) {
				http.Error(w, "Cloud membership required", http.StatusForbidden)
			} else {
				http.Error(w, "Account Manager unavailable", http.StatusServiceUnavailable)
			}
			return supportActor{}, false
		}
		if org.ID != explicitCustomerScope(r.Context()) {
			http.NotFound(w, r)
			return supportActor{}, false
		}
		role := strings.ToLower(strings.TrimSpace(org.Role))
		if role != "owner" && role != "admin" && role != "member" && role != "viewer" {
			http.Error(w, "Cloud membership required", http.StatusForbidden)
			return supportActor{}, false
		}
		if permission == "write" && role == "viewer" {
			http.Error(w, "Read-only Cloud membership", http.StatusForbidden)
			return supportActor{}, false
		}
		return supportActor{ID: session.Subject, Email: session.Email, Name: session.Email, Role: role, CloudID: org.ID, Session: session}, true
	}
	session, ok := s.requireUpstreamPlatformAdmin(w, r)
	if !ok {
		return supportActor{}, false
	}
	me, err := s.accountClient.Me(r.Context(), session.AccessToken)
	if err != nil {
		http.Error(w, "Account Manager unavailable", http.StatusServiceUnavailable)
		return supportActor{}, false
	}
	cap := "ticket.support." + permission
	if !hasCapability(me.EffectivePlatformCapabilities(), cap) {
		http.Error(w, "Insufficient support permission", http.StatusForbidden)
		return supportActor{}, false
	}
	return supportActor{ID: me.User.ID, Email: me.User.Email, Name: me.User.Name, Capabilities: me.EffectivePlatformCapabilities(), Session: session}, true
}

func supportID(w http.ResponseWriter, r *http.Request, key string) (int64, bool) {
	value := r.PathValue(key)
	if !supportNumericID.MatchString(value) {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return 0, false
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return 0, false
	}
	return id, true
}

func (s *Server) supportScopedTicket(w http.ResponseWriter, r *http.Request, actor supportActor) (zammadclient.Ticket, bool) {
	id, ok := supportID(w, r, "ticketID")
	if !ok {
		return zammadclient.Ticket{}, false
	}
	ticket, err := s.zammadClient.Ticket(r.Context(), id)
	if err != nil {
		supportUpstreamError(w, err)
		return zammadclient.Ticket{}, false
	}
	if ticket.ID != id || ticket.GroupID != s.cfg.ZammadSupportGroupID || ticket.CloudID == "" || (actor.CloudID != "" && !strings.EqualFold(ticket.CloudID, actor.CloudID)) {
		http.NotFound(w, r)
		return zammadclient.Ticket{}, false
	}
	return ticket, true
}

func supportUpstreamError(w http.ResponseWriter, err error) {
	if errors.Is(err, errSupportAgentNotProvisioned) {
		http.Error(w, "Support agent account unavailable", http.StatusServiceUnavailable)
		return
	}
	var upstream zammadclient.HTTPError
	if errors.As(err, &upstream) && upstream.Status == http.StatusNotFound {
		http.Error(w, "Ticket not found", http.StatusNotFound)
		return
	}
	http.Error(w, "Support service unavailable", http.StatusBadGateway)
}

func supportPlainText(body string) string {
	return strings.TrimSpace(html.UnescapeString(supportHTMLTag.ReplaceAllString(body, "")))
}

func (s *Server) supportTicketView(ticket zammadclient.Ticket, actor supportActor) map[string]any {
	scopeID := actor.CloudID
	if scopeID == "" {
		scopeID = "platform"
	}
	seenAt, _ := s.supportReadMarkers.SupportTicketSeenAt(actor.ID, scopeID, ticket.ID)
	publicActivity := supportPublicActivityAt(ticket)
	activity := supportActivityAt(ticket, actor)
	updatedAt := ticket.UpdatedAt
	if actor.CloudID != "" {
		updatedAt = publicActivity
	}
	assigneeID := ticket.OwnerID
	assignee := ticket.Owner
	if s.supportUnassigned(ticket) {
		assigneeID = 0
		assignee = ""
	}
	return map[string]any{
		"id": ticket.ID, "number": ticket.Number, "cloud_id": ticket.CloudID,
		"title": ticket.Title, "category": ticket.Category, "state": ticket.State,
		"created_at": ticket.CreatedAt, "updated_at": updatedAt,
		"last_public_activity_at": publicActivity, "assignee_id": assigneeID, "assignee": assignee,
		"unread": supportActivityAfter(activity, seenAt),
	}
}

func supportPublicActivityAt(ticket zammadclient.Ticket) string {
	if ticket.LastContactAt != "" {
		return ticket.LastContactAt
	}
	return ticket.CreatedAt
}

func supportActivityAt(ticket zammadclient.Ticket, actor supportActor) string {
	if actor.CloudID == "" && ticket.UpdatedAt != "" {
		return ticket.UpdatedAt
	}
	return supportPublicActivityAt(ticket)
}

func (s *Server) supportUnassigned(ticket zammadclient.Ticket) bool {
	return ticket.OwnerID == 0 || ticket.OwnerID == s.cfg.ZammadUnassignedOwnerID || ticket.Owner == "-"
}

func supportActivityAfter(activity, seenAt string) bool {
	if seenAt == "" {
		return true
	}
	activityTime, activityErr := time.Parse(time.RFC3339Nano, activity)
	seenTime, seenErr := time.Parse(time.RFC3339Nano, seenAt)
	return activityErr != nil || seenErr != nil || activityTime.After(seenTime)
}

func (s *Server) supportList(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.supportAuthorize(w, r, "read")
	if !ok {
		return
	}
	page := supportPage(r.URL.Query().Get("page"), 1, 100)
	perPage := supportPage(r.URL.Query().Get("per_page"), 30, 100)
	query := "group_id:" + strconv.FormatInt(s.cfg.ZammadSupportGroupID, 10)
	if actor.CloudID != "" {
		query += " AND rtk_cloud_uuid:" + actor.CloudID
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if len(q) > 100 {
		http.Error(w, "Search is too long", http.StatusBadRequest)
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	queue := strings.TrimSpace(r.URL.Query().Get("queue"))
	if queue != "" && queue != "team" && queue != "mine" && queue != "unassigned" {
		http.Error(w, "Invalid queue", http.StatusBadRequest)
		return
	}
	if actor.CloudID != "" && queue != "" {
		http.Error(w, "Invalid queue", http.StatusBadRequest)
		return
	}
	var mineID int64
	if queue == "mine" {
		user, err := s.supportZammadUser(r.Context(), actor, true, false)
		if err != nil {
			supportUpstreamError(w, err)
			return
		}
		mineID = user.ID
	}
	// Zammad search narrows the group and Cloud. Its API cannot express all UI
	// filters consistently, so paginate after the exact scope/queue filters.
	start, end := (page-1)*perPage, page*perPage
	items := make([]map[string]any, 0, perPage)
	matched := 0
	hasMore := false
	const upstreamPageSize = 100
	for upstreamPage := 1; upstreamPage <= 100; upstreamPage++ {
		tickets, err := s.zammadClient.SearchTickets(r.Context(), query, upstreamPage, upstreamPageSize)
		if err != nil {
			supportUpstreamError(w, err)
			return
		}
		for _, ticket := range tickets {
			if ticket.GroupID != s.cfg.ZammadSupportGroupID || ticket.CloudID == "" || (actor.CloudID != "" && !strings.EqualFold(ticket.CloudID, actor.CloudID)) ||
				(q != "" && !strings.Contains(strings.ToLower(ticket.Title+" "+ticket.Number), q)) ||
				(state != "" && state != ticket.State) ||
				(queue == "unassigned" && !s.supportUnassigned(ticket)) ||
				(queue == "mine" && ticket.OwnerID != mineID) {
				continue
			}
			if matched >= end {
				hasMore = true
				break
			}
			if matched >= start {
				items = append(items, s.supportTicketView(ticket, actor))
			}
			matched++
		}
		if hasMore || len(tickets) < upstreamPageSize {
			break
		}
		if upstreamPage == 100 {
			http.Error(w, "Support list exceeds search window", http.StatusServiceUnavailable)
			return
		}
	}
	writeJSON(w, map[string]any{"items": items, "page": page, "per_page": perPage, "has_more": hasMore})
}

func supportPage(value string, fallback, max int) int {
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return fallback
	}
	if n > max {
		return max
	}
	return n
}

func (s *Server) supportDetail(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.supportAuthorize(w, r, "read")
	if !ok {
		return
	}
	ticket, ok := s.supportScopedTicket(w, r, actor)
	if !ok {
		return
	}
	s.supportWriteDetail(w, r, ticket, actor)
}

func (s *Server) supportWriteDetail(w http.ResponseWriter, r *http.Request, ticket zammadclient.Ticket, actor supportActor) {
	view, err := s.supportDetailPayload(r.Context(), ticket, actor)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	writeJSON(w, view)
}

func (s *Server) supportDetailPayload(ctx context.Context, ticket zammadclient.Ticket, actor supportActor) (map[string]any, error) {
	articles, err := s.zammadClient.Articles(ctx, ticket.ID)
	if err != nil {
		return nil, err
	}
	public := make([]map[string]any, 0, len(articles))
	for _, article := range articles {
		if article.TicketID != ticket.ID || (actor.CloudID != "" && article.Internal) {
			continue
		}
		attachments := make([]map[string]any, 0, len(article.Attachments))
		for _, file := range article.Attachments {
			if file.ID <= 0 {
				continue
			}
			base := "/api/admin/support/tickets"
			if actor.CloudID != "" {
				base = "/api/developer/brand-clouds/" + actor.CloudID + "/support/tickets"
			}
			attachments = append(attachments, map[string]any{"id": file.ID, "filename": file.Filename, "size": file.Size, "url": fmt.Sprintf("%s/%d/articles/%d/attachments/%d", base, ticket.ID, article.ID, file.ID)})
		}
		actorID := ""
		author := article.From
		if article.Sender == "Agent" {
			if id, ok := article.Preferences["rtk_actor_id"].(string); ok {
				actorID = id
			}
			if name, ok := article.Preferences["rtk_actor_name"].(string); ok && name != "" {
				author = name
			}
		}
		if article.OriginByID > 0 {
			if user, lookupErr := s.zammadClient.User(ctx, article.OriginByID); lookupErr == nil && strings.HasPrefix(user.Login, "rtk-") {
				actorID = strings.TrimPrefix(user.Login, "rtk-")
			}
		}
		public = append(public, map[string]any{"id": article.ID, "author": author, "rtk_actor_id": actorID,
			"visibility": map[bool]string{true: "internal", false: "public"}[article.Internal], "created_at": article.CreatedAt,
			"body": supportPlainText(article.Body), "attachments": attachments, "sender": article.Sender})
	}
	view := s.supportTicketView(ticket, actor)
	view["articles"] = public
	return view, nil
}

func (s *Server) supportCreate(w http.ResponseWriter, r *http.Request) {
	if explicitCustomerScope(r.Context()) == "" {
		http.Error(w, "Customer route required", http.StatusNotFound)
		return
	}
	actor, ok := s.supportAuthorize(w, r, "write")
	if !ok {
		return
	}
	in, ok := parseSupportInput(w, r, true)
	if !ok {
		return
	}
	user, err := s.supportZammadUser(r.Context(), actor, false, true)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	article := supportArticlePayload(in, actor, user.ID, 0, false)
	ticket, err := s.zammadClient.CreateTicket(r.Context(), map[string]any{
		"title": in.Title, "group_id": s.cfg.ZammadSupportGroupID, "customer_id": user.ID,
		"rtk_cloud_uuid": actor.CloudID, "rtk_category": in.Category, "article": article,
	})
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	ticket, err = s.zammadClient.Ticket(r.Context(), ticket.ID)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	if ticket.CloudID != actor.CloudID || ticket.GroupID != s.cfg.ZammadSupportGroupID {
		http.Error(w, "Support service scope mismatch", http.StatusBadGateway)
		return
	}
	view, err := s.supportDetailPayload(r.Context(), ticket, actor)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	_ = s.supportReadMarkers.MarkSupportTicketSeen(actor.ID, actor.CloudID, ticket.ID, supportActivityAt(ticket, actor))
	writeJSONStatus(w, http.StatusCreated, view)
}

func (s *Server) supportReply(w http.ResponseWriter, r *http.Request) {
	permission := "write"
	if explicitCustomerScope(r.Context()) == "" {
		permission = "read"
	}
	actor, ok := s.supportAuthorize(w, r, permission)
	if !ok {
		return
	}
	ticket, ok := s.supportScopedTicket(w, r, actor)
	if !ok {
		return
	}
	in, ok := parseSupportInput(w, r, false)
	if !ok {
		return
	}
	if actor.CloudID != "" && in.Visibility != "" {
		http.Error(w, "Visibility is not a customer field", http.StatusBadRequest)
		return
	}
	if actor.CloudID == "" {
		if in.Visibility != "public" && in.Visibility != "internal" {
			http.Error(w, "Visibility is required", http.StatusBadRequest)
			return
		}
		if in.Visibility == "internal" && !hasCapability(actor.Capabilities, "ticket.support.note") {
			http.Error(w, "Insufficient support permission", http.StatusForbidden)
			return
		}
		if in.Visibility == "public" && !hasCapability(actor.Capabilities, "ticket.support.reply") {
			http.Error(w, "Insufficient support permission", http.StatusForbidden)
			return
		}
	}
	user, err := s.supportZammadUser(r.Context(), actor, actor.CloudID == "", true)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	_, err = s.zammadClient.CreateArticle(r.Context(), supportArticlePayload(in, actor, user.ID, ticket.ID, actor.CloudID == ""))
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	if actor.CloudID != "" && ticket.State == "closed" {
		ticket, err = s.zammadClient.UpdateTicket(r.Context(), ticket.ID, map[string]any{"state": "open"})
		if err != nil {
			supportUpstreamError(w, err)
			return
		}
	}
	updated, err := s.zammadClient.Ticket(r.Context(), ticket.ID)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	scopeID := actor.CloudID
	if scopeID == "" {
		scopeID = "platform"
	}
	_ = s.supportReadMarkers.MarkSupportTicketSeen(actor.ID, scopeID, updated.ID, supportActivityAt(updated, actor))
	s.supportWriteDetail(w, r, updated, actor)
}

func supportArticlePayload(in supportInput, actor supportActor, userID, ticketID int64, agent bool) map[string]any {
	sender := "Customer"
	if agent {
		sender = "Agent"
	}
	articleType := "web"
	if in.Visibility == "internal" {
		articleType = "note"
	}
	article := map[string]any{"body": in.Body, "content_type": "text/plain", "type": articleType, "sender": sender,
		"internal": in.Visibility == "internal", "from": actor.Name, "attachments": in.Files}
	if agent {
		// Zammad changes sender to Customer when origin_by_id is set, even if the
		// origin user is an Agent. Preserve the RTK author separately.
		article["preferences"] = map[string]any{"rtk_actor_id": actor.ID, "rtk_actor_name": actor.Name}
	} else {
		article["origin_by_id"] = userID
	}
	if ticketID > 0 {
		article["ticket_id"] = ticketID
	}
	return article
}

func (s *Server) supportPatch(w http.ResponseWriter, r *http.Request) {
	if explicitCustomerScope(r.Context()) != "" {
		http.NotFound(w, r)
		return
	}
	actor, ok := s.supportAuthorize(w, r, "read")
	if !ok {
		return
	}
	ticket, ok := s.supportScopedTicket(w, r, actor)
	if !ok {
		return
	}
	var in struct {
		OwnerID *int64 `json:"owner_id"`
		State   string `json:"state"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		http.Error(w, "Invalid update", http.StatusBadRequest)
		return
	}
	update := map[string]any{}
	if in.OwnerID != nil {
		self, err := s.supportZammadUser(r.Context(), actor, true, true)
		if err != nil {
			supportUpstreamError(w, err)
			return
		}
		if (*in.OwnerID == 0 || *in.OwnerID == self.ID) && s.supportUnassigned(ticket) && hasCapability(actor.Capabilities, "ticket.support.assign") {
			update["owner_id"] = self.ID
		} else if hasCapability(actor.Capabilities, "ticket.support.reassign") && *in.OwnerID > 0 {
			target, err := s.zammadClient.User(r.Context(), *in.OwnerID)
			if err != nil {
				supportUpstreamError(w, err)
				return
			}
			if !strings.HasPrefix(target.Login, "rtk-") || !hasCapability(target.Roles, "Agent") {
				http.Error(w, "Invalid support assignee", http.StatusBadRequest)
				return
			}
			update["owner_id"] = *in.OwnerID
		} else {
			http.Error(w, "Assignment denied", http.StatusForbidden)
			return
		}
	}
	if in.State != "" {
		if in.State != "open" && in.State != "closed" {
			http.Error(w, "Invalid state", http.StatusBadRequest)
			return
		}
		if !hasCapability(actor.Capabilities, "ticket.support.reply") {
			http.Error(w, "State change denied", http.StatusForbidden)
			return
		}
		update["state"] = in.State
	}
	if len(update) == 0 {
		http.Error(w, "Empty update", http.StatusBadRequest)
		return
	}
	_, err := s.zammadClient.UpdateTicket(r.Context(), ticket.ID, update)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	ticket, err = s.zammadClient.Ticket(r.Context(), ticket.ID)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	s.supportWriteDetail(w, r, ticket, actor)
}

func (s *Server) supportSeen(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.supportAuthorize(w, r, "read")
	if !ok {
		return
	}
	ticket, ok := s.supportScopedTicket(w, r, actor)
	if !ok {
		return
	}
	scopeID := actor.CloudID
	if scopeID == "" {
		scopeID = "platform"
	}
	activity := supportActivityAt(ticket, actor)
	if err := s.supportReadMarkers.MarkSupportTicketSeen(actor.ID, scopeID, ticket.ID, activity); err != nil {
		http.Error(w, "Read marker unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{"unread": false})
}

func (s *Server) supportAttachment(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.supportAuthorize(w, r, "read")
	if !ok {
		return
	}
	ticket, ok := s.supportScopedTicket(w, r, actor)
	if !ok {
		return
	}
	articleID, ok := supportID(w, r, "articleID")
	if !ok {
		return
	}
	attachmentID, ok := supportID(w, r, "attachmentID")
	if !ok {
		return
	}
	articles, err := s.zammadClient.Articles(r.Context(), ticket.ID)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	var found bool
	for _, article := range articles {
		if article.ID != articleID || article.TicketID != ticket.ID || (actor.CloudID != "" && article.Internal) {
			continue
		}
		for _, file := range article.Attachments {
			if file.ID == attachmentID {
				found = true
				break
			}
		}
	}
	if !found {
		http.NotFound(w, r)
		return
	}
	body, headers, err := s.zammadClient.Download(r.Context(), ticket.ID, articleID, attachmentID)
	if err != nil {
		supportUpstreamError(w, err)
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", headers.Get("Content-Type"))
	w.Header().Set("Content-Disposition", "attachment")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, io.LimitReader(body, 10<<20))
}

func (s *Server) supportZammadUser(ctx context.Context, actor supportActor, agent, create bool) (zammadclient.User, error) {
	login := "rtk-" + actor.ID
	users, err := s.zammadClient.SearchUsers(ctx, "login:"+login)
	if err != nil {
		return zammadclient.User{}, err
	}
	for _, user := range users {
		if user.Login == login {
			if agent && !hasCapability(user.Roles, "Agent") {
				return zammadclient.User{}, errSupportAgentNotProvisioned
			}
			return user, nil
		}
	}
	if agent {
		return zammadclient.User{}, errSupportAgentNotProvisioned
	}
	if !create {
		return zammadclient.User{}, nil
	}
	name := actor.Name
	if name == "" {
		name = actor.Email
	}
	user, err := s.zammadClient.CreateUser(ctx, map[string]any{"login": login, "email": actor.Email, "firstname": name, "lastname": "RTK", "roles": []string{"Customer"}})
	if err != nil {
		var upstream zammadclient.HTTPError
		if errors.As(err, &upstream) && upstream.Status == http.StatusUnprocessableEntity {
			// A prior create may have committed before the search index caught up.
			for attempt := 0; attempt < 20; attempt++ {
				if attempt > 0 {
					select {
					case <-ctx.Done():
						return zammadclient.User{}, ctx.Err()
					case <-time.After(500 * time.Millisecond):
					}
				}
				found, lookupErr := s.zammadClient.SearchUsers(ctx, "login:"+login)
				if lookupErr != nil {
					return zammadclient.User{}, lookupErr
				}
				for _, existing := range found {
					if existing.Login == login {
						return existing, nil
					}
				}
			}
		}
		return zammadclient.User{}, err
	}
	if user.Login != login {
		return zammadclient.User{}, errors.New("Zammad user identity mismatch")
	}
	return user, nil
}

func parseSupportInput(w http.ResponseWriter, r *http.Request, create bool) (supportInput, bool) {
	var in supportInput
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(25 << 20); err != nil {
			http.Error(w, "Upload too large or invalid", http.StatusRequestEntityTooLarge)
			return in, false
		}
		in.Title, in.Body, in.Category, in.Visibility = r.FormValue("title"), r.FormValue("body"), r.FormValue("category"), r.FormValue("visibility")
		files := r.MultipartForm.File["attachments"]
		if len(files) > 5 {
			http.Error(w, "Too many attachments", http.StatusBadRequest)
			return in, false
		}
		for _, header := range files {
			if header.Size > 10<<20 {
				http.Error(w, "Attachment too large", http.StatusRequestEntityTooLarge)
				return in, false
			}
			file, err := header.Open()
			if err != nil {
				http.Error(w, "Invalid attachment", http.StatusBadRequest)
				return in, false
			}
			data, err := io.ReadAll(io.LimitReader(file, (10<<20)+1))
			file.Close()
			if err != nil || len(data) > 10<<20 {
				http.Error(w, "Attachment too large", http.StatusRequestEntityTooLarge)
				return in, false
			}
			mime := http.DetectContentType(data)
			if !allowedSupportMIME(mime) {
				http.Error(w, "Unsupported attachment type", http.StatusBadRequest)
				return in, false
			}
			in.Files = append(in.Files, zammadclient.File{Filename: header.Filename, Data: base64.StdEncoding.EncodeToString(data), MIMEType: mime})
		}
	} else {
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&in) != nil {
			http.Error(w, "Invalid support request", http.StatusBadRequest)
			return in, false
		}
	}
	in.Title, in.Body, in.Category = strings.TrimSpace(in.Title), strings.TrimSpace(in.Body), strings.TrimSpace(in.Category)
	if len(in.Body) < 1 || len(in.Body) > 20000 || strings.ContainsRune(in.Body, 0) {
		http.Error(w, "Message must be 1-20000 characters", http.StatusBadRequest)
		return in, false
	}
	if create {
		if len(in.Title) < 3 || len(in.Title) > 200 {
			http.Error(w, "Subject must be 3-200 characters", http.StatusBadRequest)
			return in, false
		}
		if in.Category != "incident" && in.Category != "integration" && in.Category != "usage" {
			http.Error(w, "Invalid category", http.StatusBadRequest)
			return in, false
		}
	}
	return in, true
}

func allowedSupportMIME(mime string) bool {
	switch mime {
	case "application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain; charset=utf-8", "text/plain; charset=us-ascii":
		return true
	default:
		return false
	}
}
