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
	platformDashboardReadModelSource  = "admin_read_models"
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
	{
		ID:    "runtime_request_rate",
		Title: "Runtime request rate",
		Query: `sum by(service) (rate(http_requests_total[5m]))`,
	},
	{
		ID:    "runtime_5xx_rate",
		Title: "Runtime 5xx rate",
		Query: `sum by(service) (rate(http_status_group_total{status="5xx"}[5m]))`,
	},
	{
		ID:    "runtime_avg_latency_seconds",
		Title: "Runtime average latency",
		Query: `sum by(service) (rate(http_request_duration_seconds_sum[5m])) / sum by(service) (rate(http_request_duration_seconds_count[5m]))`,
	},
	{
		ID:    "app_up",
		Title: "Application up",
		Query: `rtk_account_manager_up or rtk_cloud_admin_up or rtk_cloud_frontend_up`,
	},
	{
		ID:    "crossservice_consumer_backlog",
		Title: "Consumer backlog",
		Query: `sum by(service) (crossservice_bus_consumer_pending_messages)`,
	},
	{
		ID:    "crossservice_dead_letters",
		Title: "Worker dead letters",
		Query: `sum by(service) (increase(crossservice_worker_dead_letters_total[1h]))`,
	},
	{
		ID:    "crossservice_publish_errors",
		Title: "Publish errors",
		Query: `sum by(service) (increase(crossservice_bus_publish_total{status="error"}[1h]))`,
	},
	{
		ID:    "crossservice_consume_errors",
		Title: "Consume errors",
		Query: `sum by(service) (increase(crossservice_bus_consume_total{status="error"}[1h]))`,
	},
	{
		ID:    "business_video_devices_online",
		Title: "Video Cloud devices online",
		Query: `video_cloud_devices_online`,
	},
	{
		ID:    "business_blob_utilization_percent",
		Title: "Blob utilization",
		Query: `video_cloud_blob_capacity_utilization_percent`,
	},
	{
		ID:    "business_exporter_success",
		Title: "Exporter success",
		Query: `video_cloud_exporter_last_collect_success`,
	},
	{
		ID:    "business_quota_requests",
		Title: "Quota requests",
		Query: `rtk_account_manager_quota_raise_requests`,
	},
	{
		ID:    "business_eval_signups_24h",
		Title: "Evaluation signups",
		Query: `increase(rtk_account_manager_eval_signups_total[24h])`,
	},
	{
		ID:    "infra_cpu_utilization_percent",
		Title: "CPU utilization",
		Query: `100 - avg by(role) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100`,
	},
	{
		ID:    "infra_memory_utilization_percent",
		Title: "Memory utilization",
		Query: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`,
	},
	{
		ID:    "infra_disk_utilization_percent",
		Title: "Disk utilization",
		Query: `(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100`,
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
	summary, operations, err := s.platformDashboardReadModels(r.Context(), session)
	if err != nil {
		s.writeUpstreamReadError(w, err)
		return
	}
	writeJSON(w, s.platformDashboard(r.Context(), summary, operations))
}

func (s *Server) platformDashboardReadModels(ctx context.Context, session store.Session) (contracts.Summary, []contracts.Operation, error) {
	if s.usePlatformAdminUpstream(session) {
		devices, err := s.platformAdminDevices(ctx, session)
		if err != nil {
			return contracts.Summary{}, nil, err
		}
		operations, err := s.platformAdminOperations(ctx, session)
		if err != nil {
			return contracts.Summary{}, nil, err
		}
		return summaryFromReadModels(devices, operations), operations, nil
	}
	summary, err := s.projections.Summary()
	if err != nil {
		return contracts.Summary{}, nil, err
	}
	operations, err := s.projections.ListOperations()
	if err != nil {
		return contracts.Summary{}, nil, err
	}
	return summary, operations, nil
}

func (s *Server) platformDashboard(ctx context.Context, summary contracts.Summary, operations []contracts.Operation) contracts.PlatformDashboard {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	adminSource := contracts.PlatformDashboardSource{
		SourceStatus: platformDashboardSourceConfigured,
		CheckedAt:    checkedAt,
	}
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
			KPIs: buildPlatformDashboardKPIs(summary, map[string]contracts.PlatformDashboardPrometheusQuery{
				"scrape_targets_down": {
					SourceStatus: platformDashboardSourceUnconfigured,
					Series:       []contracts.PlatformDashboardPrometheusSeries{},
				},
			}),
			ServiceScrapeHealth: buildPlatformDashboardServiceScrapeHealth(queries),
			OperationRisk:       buildPlatformDashboardOperationRisk(summary, operations),
			Sources: map[string]contracts.PlatformDashboardSource{
				platformDashboardPrometheusSource: source,
				platformDashboardReadModelSource:  adminSource,
			},
			PanelSources: platformDashboardPanelSources(adminSource, source),
			Prometheus:   contracts.PlatformDashboardPrometheus{Queries: queries},
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
	queriesByID := platformDashboardQueriesByID(queries)
	return contracts.PlatformDashboard{
		Summary:             summary,
		KPIs:                buildPlatformDashboardKPIs(summary, queriesByID),
		ServiceScrapeHealth: buildPlatformDashboardServiceScrapeHealth(queries),
		OperationRisk:       buildPlatformDashboardOperationRisk(summary, operations),
		Sources: map[string]contracts.PlatformDashboardSource{
			platformDashboardPrometheusSource: source,
			platformDashboardReadModelSource:  adminSource,
		},
		PanelSources: platformDashboardPanelSources(adminSource, source),
		Prometheus:   contracts.PlatformDashboardPrometheus{Queries: queries},
	}
}

func platformDashboardPanelSources(adminSource, prometheusSource contracts.PlatformDashboardSource) map[string]contracts.PlatformDashboardSource {
	return map[string]contracts.PlatformDashboardSource{
		"kpis":                  mixedPanelSource(adminSource, prometheusSource),
		"service_scrape_health": prometheusSource,
		"operation_risk":        adminSource,
	}
}

func mixedPanelSource(primary, secondary contracts.PlatformDashboardSource) contracts.PlatformDashboardSource {
	if secondary.SourceStatus == platformDashboardSourceConfigured {
		return primary
	}
	source := secondary
	source.SourceMessage = fallback(source.SourceMessage, "Some dashboard data is unavailable.")
	return source
}

func buildPlatformDashboardKPIs(summary contracts.Summary, queriesByID map[string]contracts.PlatformDashboardPrometheusQuery) []contracts.PlatformDashboardKPI {
	scrapeTargetsDown := queriesByID["scrape_targets_down"]
	return []contracts.PlatformDashboardKPI{
		{
			ID:           "tenants",
			Label:        "Tenants",
			Value:        float64(summary.Customers),
			SourceStatus: platformDashboardSourceConfigured,
		},
		{
			ID:             "devices_online",
			Label:          "Devices Online",
			Value:          float64(summary.OnlineDevices),
			Unit:           "devices",
			SecondaryLabel: "online_rate_pct",
			SecondaryValue: percent(summary.OnlineDevices, summary.TotalDevices),
			SourceStatus:   platformDashboardSourceConfigured,
		},
		{
			ID:           "open_operations",
			Label:        "Open Operations",
			Value:        float64(summary.OpenOperations),
			SourceStatus: platformDashboardSourceConfigured,
		},
		{
			ID:           "scrape_targets_down",
			Label:        "Scrape Targets Down",
			Value:        sumPrometheusSeries(scrapeTargetsDown),
			SourceStatus: fallback(scrapeTargetsDown.SourceStatus, platformDashboardSourceUnconfigured),
		},
	}
}

func buildPlatformDashboardOperationRisk(summary contracts.Summary, operations []contracts.Operation) contracts.PlatformDashboardOperationRisk {
	risk := contracts.PlatformDashboardOperationRisk{
		OpenOperations: summary.OpenOperations,
		SourceStatus:   platformDashboardSourceConfigured,
	}
	for _, op := range operations {
		switch op.State {
		case contracts.OperationFailed:
			risk.FailedOperations++
		case contracts.OperationDeadLettered:
			risk.DeadLetteredOperations++
		}
	}
	return risk
}

func buildPlatformDashboardServiceScrapeHealth(queries []contracts.PlatformDashboardPrometheusQuery) []contracts.PlatformDashboardServiceScrapeHealth {
	queriesByID := platformDashboardQueriesByID(queries)
	up := queriesByID["scrape_targets_up"]
	down := queriesByID["scrape_targets_down"]
	groups := []contracts.PlatformDashboardServiceScrapeHealth{
		{ID: "app", Name: "App", SourceStatus: combinedPrometheusQueryStatus(up, down)},
		{ID: "host", Name: "Host", SourceStatus: combinedPrometheusQueryStatus(up, down)},
		{ID: "data", Name: "Data", SourceStatus: combinedPrometheusQueryStatus(up, down)},
		{ID: "broker", Name: "Broker", SourceStatus: combinedPrometheusQueryStatus(up, down)},
		{ID: "gateway", Name: "Gateway", SourceStatus: combinedPrometheusQueryStatus(up, down)},
	}
	for i := range groups {
		groups[i].TargetsUp = int(sumPrometheusSeriesForGroup(up, groups[i].ID))
		groups[i].TargetsDown = int(sumPrometheusSeriesForGroup(down, groups[i].ID))
		groups[i].TargetsTotal = groups[i].TargetsUp + groups[i].TargetsDown
		groups[i].Status = platformDashboardScrapeGroupStatus(groups[i])
	}
	return groups
}

func platformDashboardQueriesByID(queries []contracts.PlatformDashboardPrometheusQuery) map[string]contracts.PlatformDashboardPrometheusQuery {
	byID := make(map[string]contracts.PlatformDashboardPrometheusQuery, len(queries))
	for _, query := range queries {
		byID[query.ID] = query
	}
	return byID
}

func sumPrometheusSeries(query contracts.PlatformDashboardPrometheusQuery) float64 {
	var total float64
	for _, series := range query.Series {
		total += series.Value
	}
	return total
}

func sumPrometheusSeriesForGroup(query contracts.PlatformDashboardPrometheusQuery, groupID string) float64 {
	var total float64
	for _, series := range query.Series {
		if platformDashboardScrapeGroup(series.Labels) == groupID {
			total += series.Value
		}
	}
	return total
}

func platformDashboardScrapeGroup(labels map[string]string) string {
	job := strings.ToLower(labels["job"])
	role := strings.ToLower(labels["role"])
	switch {
	case job == "node":
		return "host"
	case job == "postgres" || job == "redis":
		return "data"
	case job == "nats" || job == "emqx" || role == "mqtt":
		return "broker"
	case job == "nginx" || role == "edge" || role == "gateway":
		return "gateway"
	default:
		return "app"
	}
}

func platformDashboardScrapeGroupStatus(group contracts.PlatformDashboardServiceScrapeHealth) string {
	switch {
	case group.SourceStatus == platformDashboardSourceUnconfigured || group.SourceStatus == platformDashboardSourceUnavailable:
		return group.SourceStatus
	case group.SourceStatus == platformDashboardSourceEmpty || group.TargetsTotal == 0:
		return platformDashboardSourceEmpty
	case group.TargetsDown > 0:
		return "degraded"
	default:
		return "ok"
	}
}

func combinedPrometheusQueryStatus(queries ...contracts.PlatformDashboardPrometheusQuery) string {
	anyUnavailable := false
	anyStale := false
	anyConfigured := false
	anyEmpty := false
	for _, query := range queries {
		switch query.SourceStatus {
		case platformDashboardSourceUnavailable, platformDashboardSourceUnconfigured:
			anyUnavailable = query.SourceStatus == platformDashboardSourceUnavailable || anyUnavailable
			if query.SourceStatus == platformDashboardSourceUnconfigured {
				return platformDashboardSourceUnconfigured
			}
		case platformDashboardSourceStale:
			anyStale = true
		case platformDashboardSourceConfigured:
			anyConfigured = true
		case platformDashboardSourceEmpty:
			anyEmpty = true
		}
	}
	switch {
	case anyUnavailable:
		return platformDashboardSourceUnavailable
	case anyStale:
		return platformDashboardSourceStale
	case anyConfigured:
		return platformDashboardSourceConfigured
	case anyEmpty:
		return platformDashboardSourceEmpty
	default:
		return platformDashboardSourceEmpty
	}
}

func percent(numerator, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return toTwoDecimal(float64(numerator) / float64(denominator) * 100)
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
