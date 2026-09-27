package zammadclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is used only by Cloud Admin's server-side ticket adapter.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type Ticket struct {
	ID            int64  `json:"id"`
	Number        string `json:"number"`
	Title         string `json:"title"`
	CloudID       string `json:"rtk_cloud_uuid"`
	Category      string `json:"rtk_category"`
	GroupID       int64  `json:"group_id"`
	OwnerID       int64  `json:"owner_id"`
	Owner         string `json:"owner"`
	StateID       int64  `json:"state_id"`
	State         string `json:"state"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
	LastContactAt string `json:"last_contact_at"`
}

type Attachment struct {
	ID          int64          `json:"id"`
	Filename    string         `json:"filename"`
	Size        string         `json:"size"`
	Preferences map[string]any `json:"preferences"`
}

type Article struct {
	ID          int64          `json:"id"`
	TicketID    int64          `json:"ticket_id"`
	Body        string         `json:"body"`
	ContentType string         `json:"content_type"`
	Internal    bool           `json:"internal"`
	Sender      string         `json:"sender"`
	From        string         `json:"from"`
	OriginByID  int64          `json:"origin_by_id"`
	Preferences map[string]any `json:"preferences"`
	CreatedByID int64          `json:"created_by_id"`
	CreatedAt   string         `json:"created_at"`
	Attachments []Attachment   `json:"attachments"`
}

type User struct {
	ID        int64    `json:"id"`
	Login     string   `json:"login"`
	Email     string   `json:"email"`
	Firstname string   `json:"firstname"`
	Lastname  string   `json:"lastname"`
	Roles     []string `json:"roles"`
}

type File struct {
	Filename string `json:"filename"`
	Data     string `json:"data"`
	MIMEType string `json:"mime-type"`
}

type HTTPError struct{ Status int }

func (e HTTPError) Error() string { return fmt.Sprintf("Zammad returned HTTP %d", e.Status) }

func New(baseURL, token string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) Enabled() bool { return c != nil && c.baseURL != "" && c.token != "" }

func (c *Client) request(ctx context.Context, method, path string, body any, out any) error {
	if !c.Enabled() {
		return errors.New("Zammad is not configured")
	}
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		input = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, input)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Token token="+c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Zammad-Suppress-Notifications", "true")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return HTTPError{Status: resp.StatusCode}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

func (c *Client) Ticket(ctx context.Context, id int64) (Ticket, error) {
	var ticket Ticket
	err := c.request(ctx, "GET", fmt.Sprintf("/api/v1/tickets/%d?expand=true", id), nil, &ticket)
	return ticket, err
}

func (c *Client) SearchTickets(ctx context.Context, query string, page, perPage int) ([]Ticket, error) {
	values := url.Values{"query": {query}, "expand": {"true"}, "page": {fmt.Sprint(page)}, "per_page": {fmt.Sprint(perPage)}, "sort_by": {"updated_at"}, "order_by": {"desc"}}
	var tickets []Ticket
	err := c.request(ctx, "GET", "/api/v1/tickets/search?"+values.Encode(), nil, &tickets)
	return tickets, err
}

func (c *Client) Articles(ctx context.Context, ticketID int64) ([]Article, error) {
	var articles []Article
	err := c.request(ctx, "GET", fmt.Sprintf("/api/v1/ticket_articles/by_ticket/%d", ticketID), nil, &articles)
	return articles, err
}

func (c *Client) CreateTicket(ctx context.Context, body map[string]any) (Ticket, error) {
	var ticket Ticket
	err := c.request(ctx, "POST", "/api/v1/tickets", body, &ticket)
	return ticket, err
}

func (c *Client) UpdateTicket(ctx context.Context, id int64, body map[string]any) (Ticket, error) {
	var ticket Ticket
	err := c.request(ctx, "PUT", fmt.Sprintf("/api/v1/tickets/%d", id), body, &ticket)
	return ticket, err
}

func (c *Client) CreateArticle(ctx context.Context, body map[string]any) (Article, error) {
	var article Article
	err := c.request(ctx, "POST", "/api/v1/ticket_articles", body, &article)
	return article, err
}

func (c *Client) SearchUsers(ctx context.Context, query string) ([]User, error) {
	var users []User
	err := c.request(ctx, "GET", "/api/v1/users/search?query="+url.QueryEscape(query)+"&expand=true", nil, &users)
	return users, err
}

func (c *Client) User(ctx context.Context, id int64) (User, error) {
	var user User
	err := c.request(ctx, "GET", fmt.Sprintf("/api/v1/users/%d?expand=true", id), nil, &user)
	return user, err
}

func (c *Client) CreateUser(ctx context.Context, body map[string]any) (User, error) {
	var user User
	err := c.request(ctx, "POST", "/api/v1/users", body, &user)
	return user, err
}

func (c *Client) Download(ctx context.Context, ticketID, articleID, attachmentID int64) (io.ReadCloser, http.Header, error) {
	if !c.Enabled() {
		return nil, nil, errors.New("Zammad is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/ticket_attachment/%d/%d/%d", c.baseURL, ticketID, articleID, attachmentID), nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Token token="+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, nil, HTTPError{Status: resp.StatusCode}
	}
	return resp.Body, resp.Header, nil
}
