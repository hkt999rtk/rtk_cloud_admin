package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/store"
)

const (
	platformDashboardSourceConfigured   = "configured"
	platformDashboardSourceUnconfigured = "unconfigured"
	platformDashboardSourceUnavailable  = "unavailable"
	platformDashboardSourceEmpty        = "empty"
	platformDashboardSourceStale        = "stale"

	platformDashboardPrometheusSource = "prometheus"
)

var platformDashboardPrometheusQueries = []prometheusQueryDefinition{
	{
		ID:    "scrape_targets_up",
		Title: "Scrape targets up",
		Query: `sum by(job, service, role) (up)`,
	},
	{
		ID:    "scrape_targets_down",
		Title: "Scrape targets down",
		Query: `sum by(job, service, role) (up == 0)`,
	},
	{
		ID:           "exporter_freshness_seconds",
		Title:        "Exporter freshness",
		Query:        `time() - video_cloud_exporter_last_collect_timestamp_seconds`,
		StaleAfter:   5 * time.Minute,
		StaleMessage: "Prometheus data is stale.",
	},
}

type prometheusQueryDefinition struct {
	ID           string
	Title        string
	Query        string
	StaleAfter   time.Duration
	StaleMessage string
}

type prometheusClient struct {
	baseURL    string
	httpClient *http.Client
}

func (s *Server) apiAdminPlatformDashboard(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	summary, err := s.platformDashboardSummary(r.Context(), session)
	if err != nil {
		s.writeUpstreamReadError(w, err)
		return
	}
	writeJSON(w, s.platformDashboard(r.Context(), summary))
}

func (s *Server) platformDashboardSummary(ctx context.Context, session store.Session) (contracts.Summary, error) {
	if s.usePlatformAdminUpstream(session) {
		return s.platformAdminSummary(ctx, session)
	}
	return s.store.Summary()
}

func (s *Server) platformDashboard(ctx context.Context, summary contracts.Summary) contracts.PlatformDashboard {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	source := contracts.PlatformDashboardSource{
		SourceStatus:  platformDashboardSourceUnconfigured,
		SourceMessage: "Prometheus is not configured.",
		CheckedAt:     checkedAt,
	}
	queries := make([]contracts.PlatformDashboardPrometheusQuery, 0, len(platformDashboardPrometheusQueries))
	client := newPrometheusClient(s.cfg.VideoCloudPrometheusBaseURL)
	if !client.configured() {
		for _, def := range platformDashboardPrometheusQueries {
			queries = append(queries, contracts.PlatformDashboardPrometheusQuery{
				ID:           def.ID,
				Title:        def.Title,
				SourceStatus: platformDashboardSourceUnconfigured,
				CheckedAt:    checkedAt,
				Series:       []contracts.PlatformDashboardPrometheusSeries{},
			})
		}
		return contracts.PlatformDashboard{
			Summary: summary,
			Sources: map[string]contracts.PlatformDashboardSource{
				platformDashboardPrometheusSource: source,
			},
			Prometheus: contracts.PlatformDashboardPrometheus{Queries: queries},
		}
	}

	source.SourceStatus = platformDashboardSourceConfigured
	source.SourceMessage = ""
	anyUnavailable := false
	anyStale := false
	anyConfigured := false
	anyEmpty := false
	for _, def := range platformDashboardPrometheusQueries {
		result, err := client.query(ctx, def)
		if err != nil {
			anyUnavailable = true
			queries = append(queries, unavailablePlatformDashboardQuery(def, checkedAt))
			continue
		}
		switch result.SourceStatus {
		case platformDashboardSourceStale:
			anyStale = true
		case platformDashboardSourceConfigured:
			anyConfigured = true
		case platformDashboardSourceEmpty:
			anyEmpty = true
		}
		queries = append(queries, result)
	}
	switch {
	case anyUnavailable:
		source.SourceStatus = platformDashboardSourceUnavailable
		source.SourceMessage = "Prometheus source is unavailable."
	case anyStale:
		source.SourceStatus = platformDashboardSourceStale
		source.SourceMessage = "Prometheus data is stale."
	case anyConfigured:
		source.SourceStatus = platformDashboardSourceConfigured
	case anyEmpty:
		source.SourceStatus = platformDashboardSourceEmpty
		source.SourceMessage = "Prometheus returned no dashboard data."
	}
	source.CheckedAt = checkedAt
	return contracts.PlatformDashboard{
		Summary: summary,
		Sources: map[string]contracts.PlatformDashboardSource{
			platformDashboardPrometheusSource: source,
		},
		Prometheus: contracts.PlatformDashboardPrometheus{Queries: queries},
	}
}

func newPrometheusClient(baseURL string) prometheusClient {
	return prometheusClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{
			Timeout: 2 * time.Second,
		},
	}
}

func (c prometheusClient) configured() bool {
	return c.baseURL != ""
}

func (c prometheusClient) query(ctx context.Context, def prometheusQueryDefinition) (contracts.PlatformDashboardPrometheusQuery, error) {
	if !c.configured() {
		return contracts.PlatformDashboardPrometheusQuery{}, errors.New("prometheus is not configured")
	}
	endpoint, err := url.Parse(c.baseURL + "/api/v1/query")
	if err != nil {
		return contracts.PlatformDashboardPrometheusQuery{}, err
	}
	query := endpoint.Query()
	query.Set("query", def.Query)
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return contracts.PlatformDashboardPrometheusQuery{}, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return contracts.PlatformDashboardPrometheusQuery{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return contracts.PlatformDashboardPrometheusQuery{}, fmt.Errorf("prometheus query failed with status %d", resp.StatusCode)
	}
	var body prometheusQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return contracts.PlatformDashboardPrometheusQuery{}, err
	}
	if body.Status != "success" || body.Data.ResultType != "vector" {
		return contracts.PlatformDashboardPrometheusQuery{}, errors.New("prometheus returned an unsupported response")
	}

	checkedAt := time.Now().UTC().Format(time.RFC3339)
	result := contracts.PlatformDashboardPrometheusQuery{
		ID:           def.ID,
		Title:        def.Title,
		SourceStatus: platformDashboardSourceConfigured,
		CheckedAt:    checkedAt,
		Series:       []contracts.PlatformDashboardPrometheusSeries{},
	}
	for _, item := range body.Data.Result {
		value, ok := item.floatValue()
		if !ok {
			continue
		}
		result.Series = append(result.Series, contracts.PlatformDashboardPrometheusSeries{
			Labels: allowlistedPrometheusLabels(item.Metric),
			Value:  value,
		})
	}
	if len(result.Series) == 0 {
		result.SourceStatus = platformDashboardSourceEmpty
		return result, nil
	}
	if def.StaleAfter > 0 {
		for _, series := range result.Series {
			if series.Value > def.StaleAfter.Seconds() {
				result.SourceStatus = platformDashboardSourceStale
				return result, nil
			}
		}
	}
	return result, nil
}

func unavailablePlatformDashboardQuery(def prometheusQueryDefinition, checkedAt string) contracts.PlatformDashboardPrometheusQuery {
	return contracts.PlatformDashboardPrometheusQuery{
		ID:           def.ID,
		Title:        def.Title,
		SourceStatus: platformDashboardSourceUnavailable,
		CheckedAt:    checkedAt,
		Series:       []contracts.PlatformDashboardPrometheusSeries{},
	}
}

func allowlistedPrometheusLabels(labels map[string]string) map[string]string {
	out := map[string]string{}
	for _, key := range []string{"job", "service", "role"} {
		if value := strings.TrimSpace(labels[key]); value != "" {
			out[key] = value
		}
	}
	return out
}

type prometheusQueryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string                 `json:"resultType"`
		Result     []prometheusVectorItem `json:"result"`
	} `json:"data"`
}

type prometheusVectorItem struct {
	Metric map[string]string `json:"metric"`
	Value  []any             `json:"value"`
}

func (v prometheusVectorItem) floatValue() (float64, bool) {
	if len(v.Value) < 2 {
		return 0, false
	}
	switch value := v.Value[1].(type) {
	case string:
		parsed, err := strconv.ParseFloat(value, 64)
		return parsed, err == nil
	case float64:
		return value, true
	default:
		return 0, false
	}
}
