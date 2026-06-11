package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
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
	platformDashboardSourceUnmonitored  = "unmonitored"

	platformDashboardPrometheusSource = "prometheus"
	platformDashboardReadModelSource  = "admin_read_models"
)

var platformDashboardServerResources = []struct {
	ID       string
	Label    string
	Role     string
	NodeRole string
}{
	{ID: "edge", Label: "Edge", Role: "Video Cloud gateway", NodeRole: "edge"},
	{ID: "api", Label: "API", Role: "Video Cloud API", NodeRole: "api"},
	{ID: "infra", Label: "Infra", Role: "PostgreSQL, Redis, Prometheus", NodeRole: "infra"},
	{ID: "mqtt", Label: "MQTT", Role: "EMQX broker", NodeRole: "mqtt"},
	{ID: "coturn", Label: "Coturn", Role: "TURN relay", NodeRole: "coturn"},
	{ID: "account-manager", Label: "Account Manager", Role: "Account Manager", NodeRole: "account-manager"},
	{ID: "cloud-admin", Label: "Cloud Admin", Role: "Admin Console", NodeRole: "admin"},
	{ID: "cloud-logger", Label: "Cloud Logger", Role: "Log ingestion", NodeRole: "cloud-logger"},
}

var platformDashboardServiceExporters = []struct {
	ID       string
	Label    string
	Role     string
	Services []string
	Roles    []string
}{
	{ID: "account-manager", Label: "Account Manager", Role: "Account and tenant APIs", Services: []string{"account-manager"}},
	{ID: "cloud-admin", Label: "Cloud Admin", Role: "Platform admin console", Services: []string{"cloud-admin"}},
	{ID: "cloud-logger", Label: "Cloud Logger", Role: "Central log backend", Services: []string{"cloud-logger"}},
	{ID: "coturn", Label: "Coturn", Role: "TURN relay host exporter", Services: []string{"coturn-node"}, Roles: []string{"coturn"}},
}

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
		Query: `rtk_account_manager_up or rtk_cloud_admin_up or rtk_cloud_frontend_up or rtk_cloud_logger_up`,
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
	{
		ID:    "infra_network_in_bps",
		Title: "Network inbound throughput",
		Query: `sum by(role) (rate(node_network_receive_bytes_total{device!~"lo|docker.*|veth.*|br-.*|cni.*|flannel.*"}[5m])) * 8`,
	},
	{
		ID:    "infra_network_out_bps",
		Title: "Network outbound throughput",
		Query: `sum by(role) (rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*|cni.*|flannel.*"}[5m])) * 8`,
	},
}

var platformResourceTrendQueries = []prometheusQueryDefinition{
	{
		ID:    "cpu_percent",
		Title: "CPU utilization",
		Query: `100 - avg by(role) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100`,
	},
	{
		ID:    "memory_percent",
		Title: "Memory utilization",
		Query: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`,
	},
	{
		ID:    "disk_percent",
		Title: "Disk utilization",
		Query: `(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100`,
	},
	{
		ID:    "network_in_bps",
		Title: "Network inbound throughput",
		Query: `sum by(role) (rate(node_network_receive_bytes_total{device!~"lo|docker.*|veth.*|br-.*|cni.*|flannel.*"}[5m])) * 8`,
	},
	{
		ID:    "network_out_bps",
		Title: "Network outbound throughput",
		Query: `sum by(role) (rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*|cni.*|flannel.*"}[5m])) * 8`,
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

func (s *Server) apiAdminPlatformResourceTrends(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePlatformAdmin(w, r); !ok {
		return
	}
	payload := s.platformResourceTrends(r.Context(), r.URL.Query().Get("range"))
	writeJSON(w, payload)
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
			ServiceExporters:    buildPlatformDashboardServiceExporters(platformDashboardQueriesByID(queries)),
			ServerResources:     buildPlatformDashboardServerResources(platformDashboardQueriesByID(queries)),
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
		ServiceExporters:    buildPlatformDashboardServiceExporters(queriesByID),
		ServerResources:     buildPlatformDashboardServerResources(queriesByID),
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
		"service_exporters":     prometheusSource,
		"server_resources":      prometheusSource,
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

func buildPlatformDashboardServiceExporters(queriesByID map[string]contracts.PlatformDashboardPrometheusQuery) []contracts.PlatformDashboardServiceExporter {
	up := queriesByID["scrape_targets_up"]
	down := queriesByID["scrape_targets_down"]
	rows := make([]contracts.PlatformDashboardServiceExporter, 0, len(platformDashboardServiceExporters))
	for _, exporter := range platformDashboardServiceExporters {
		row := contracts.PlatformDashboardServiceExporter{
			ID:           exporter.ID,
			Label:        exporter.Label,
			Role:         exporter.Role,
			SourceStatus: combinedPrometheusQueryStatus(up, down),
			CheckedAt:    firstNonEmpty(up.CheckedAt, down.CheckedAt),
		}
		row.TargetsUp = int(sumPrometheusSeriesForExporter(up, exporter.Services, exporter.Roles))
		row.TargetsDown = int(sumPrometheusSeriesForExporter(down, exporter.Services, exporter.Roles))
		row.TargetsTotal = row.TargetsUp + row.TargetsDown
		row.Status = platformDashboardExporterStatus(row)
		rows = append(rows, row)
	}
	return rows
}

func buildPlatformDashboardServerResources(queriesByID map[string]contracts.PlatformDashboardPrometheusQuery) []contracts.PlatformDashboardServerResource {
	cpu := queriesByID["infra_cpu_utilization_percent"]
	memory := queriesByID["infra_memory_utilization_percent"]
	disk := queriesByID["infra_disk_utilization_percent"]
	networkIn := queriesByID["infra_network_in_bps"]
	networkOut := queriesByID["infra_network_out_bps"]
	rows := make([]contracts.PlatformDashboardServerResource, 0, len(platformDashboardServerResources))
	for _, server := range platformDashboardServerResources {
		row := contracts.PlatformDashboardServerResource{
			ID:           server.ID,
			Label:        server.Label,
			Role:         server.Role,
			Status:       platformDashboardSourceUnmonitored,
			SourceStatus: platformDashboardServerResourceSourceStatus(cpu, memory, disk, networkIn, networkOut),
			CheckedAt:    firstNonEmpty(cpu.CheckedAt, memory.CheckedAt, disk.CheckedAt, networkIn.CheckedAt, networkOut.CheckedAt),
		}
		if row.SourceStatus == platformDashboardSourceConfigured || row.SourceStatus == platformDashboardSourceStale || row.SourceStatus == platformDashboardSourceEmpty {
			row.CPUPercent = prometheusSeriesValueForRole(cpu, server.NodeRole)
			row.MemoryPercent = prometheusSeriesValueForRole(memory, server.NodeRole)
			row.DiskPercent = prometheusSeriesValueForRole(disk, server.NodeRole)
			row.NetworkInBPS = prometheusSeriesValueForRole(networkIn, server.NodeRole)
			row.NetworkOutBPS = prometheusSeriesValueForRole(networkOut, server.NodeRole)
			hasStatusMetrics := row.CPUPercent != nil || row.MemoryPercent != nil || row.DiskPercent != nil
			if hasStatusMetrics || row.NetworkInBPS != nil || row.NetworkOutBPS != nil {
				row.SourceStatus = combinedPrometheusQueryStatus(cpu, memory, disk, networkIn, networkOut)
				if hasStatusMetrics {
					row.Status = platformDashboardServerResourceStatus(row)
				}
			} else {
				row.SourceStatus = platformDashboardSourceUnmonitored
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (s *Server) platformResourceTrends(ctx context.Context, requestedRange string) contracts.PlatformResourceTrends {
	trendRange := platformResourceTrendRange(requestedRange)
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	payload := contracts.PlatformResourceTrends{
		Range:       trendRange.ID,
		StepSeconds: int64(trendRange.Step.Seconds()),
		CheckedAt:   checkedAt,
		Source: contracts.PlatformDashboardSource{
			SourceStatus:  platformDashboardSourceUnconfigured,
			SourceMessage: "Prometheus is not configured.",
			CheckedAt:     checkedAt,
		},
		Series:    []contracts.PlatformResourceTrendSeries{},
		Summaries: emptyPlatformResourceTrendSummaries(platformDashboardSourceUnconfigured),
	}
	client := newPrometheusClient(s.cfg.VideoCloudPrometheusBaseURL)
	if !client.configured() {
		return payload
	}

	end := time.Now().UTC()
	start := end.Add(-trendRange.Duration)
	byMetric := map[string][]contracts.PlatformResourceTrendSeries{}
	anyUnavailable := false
	anyConfigured := false
	anyEmpty := false
	for _, def := range platformResourceTrendQueries {
		series, err := client.queryRange(ctx, def, start, end, trendRange.Step)
		if err != nil {
			anyUnavailable = true
			byMetric[def.ID] = unavailablePlatformResourceTrendSeries(def.ID)
			continue
		}
		if len(series) == 0 {
			anyEmpty = true
		} else {
			anyConfigured = true
		}
		byMetric[def.ID] = series
	}

	payload.Source.SourceStatus = platformDashboardSourceConfigured
	payload.Source.SourceMessage = ""
	switch {
	case anyUnavailable:
		payload.Source.SourceStatus = platformDashboardSourceUnavailable
		payload.Source.SourceMessage = "Prometheus source is unavailable."
	case anyConfigured:
		payload.Source.SourceStatus = platformDashboardSourceConfigured
	case anyEmpty:
		payload.Source.SourceStatus = platformDashboardSourceEmpty
		payload.Source.SourceMessage = "Prometheus returned no resource trend data."
	}
	payload.Series = normalizePlatformResourceTrendSeries(byMetric)
	payload.Summaries = buildPlatformResourceTrendSummaries(payload.Series, payload.Source.SourceStatus)
	return payload
}

type platformResourceRange struct {
	ID       string
	Duration time.Duration
	Step     time.Duration
}

func platformResourceTrendRange(value string) platformResourceRange {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "7d":
		return platformResourceRange{ID: "7d", Duration: 7 * 24 * time.Hour, Step: time.Hour}
	case "90d":
		return platformResourceRange{ID: "90d", Duration: 90 * 24 * time.Hour, Step: 24 * time.Hour}
	default:
		return platformResourceRange{ID: "24h", Duration: 24 * time.Hour, Step: 5 * time.Minute}
	}
}

func normalizePlatformResourceTrendSeries(byMetric map[string][]contracts.PlatformResourceTrendSeries) []contracts.PlatformResourceTrendSeries {
	out := []contracts.PlatformResourceTrendSeries{}
	for _, def := range platformResourceTrendQueries {
		seriesByServer := map[string]contracts.PlatformResourceTrendSeries{}
		for _, series := range byMetric[def.ID] {
			seriesByServer[series.ServerID] = series
		}
		for _, server := range platformDashboardServerResources {
			series, ok := seriesByServer[server.ID]
			if !ok {
				series = contracts.PlatformResourceTrendSeries{
					ServerID:     server.ID,
					Label:        server.Label,
					Role:         server.Role,
					Metric:       def.ID,
					Unit:         platformResourceTrendUnit(def.ID),
					SourceStatus: platformDashboardSourceUnmonitored,
					Points:       []contracts.PlatformResourceTrendPoint{},
				}
			}
			out = append(out, series)
		}
	}
	return out
}

func unavailablePlatformResourceTrendSeries(metric string) []contracts.PlatformResourceTrendSeries {
	out := make([]contracts.PlatformResourceTrendSeries, 0, len(platformDashboardServerResources))
	for _, server := range platformDashboardServerResources {
		out = append(out, contracts.PlatformResourceTrendSeries{
			ServerID:     server.ID,
			Label:        server.Label,
			Role:         server.Role,
			Metric:       metric,
			Unit:         platformResourceTrendUnit(metric),
			SourceStatus: platformDashboardSourceUnavailable,
			Points:       []contracts.PlatformResourceTrendPoint{},
		})
	}
	return out
}

func emptyPlatformResourceTrendSummaries(status string) []contracts.PlatformResourceTrendSummary {
	out := make([]contracts.PlatformResourceTrendSummary, 0, len(platformDashboardServerResources))
	for _, server := range platformDashboardServerResources {
		out = append(out, contracts.PlatformResourceTrendSummary{
			ServerID:     server.ID,
			Label:        server.Label,
			Role:         server.Role,
			SourceStatus: status,
		})
	}
	return out
}

func buildPlatformResourceTrendSummaries(series []contracts.PlatformResourceTrendSeries, fallbackStatus string) []contracts.PlatformResourceTrendSummary {
	byServer := map[string]*contracts.PlatformResourceTrendSummary{}
	for _, server := range platformDashboardServerResources {
		byServer[server.ID] = &contracts.PlatformResourceTrendSummary{
			ServerID:     server.ID,
			Label:        server.Label,
			Role:         server.Role,
			SourceStatus: fallbackStatus,
		}
	}
	for _, item := range series {
		summary := byServer[item.ServerID]
		if summary == nil {
			continue
		}
		metricSummary := platformResourceMetricSummary(item.Points)
		if metricSummary.Current != nil {
			summary.SourceStatus = item.SourceStatus
		}
		switch item.Metric {
		case "cpu_percent":
			summary.CPUPercent = metricSummary
		case "memory_percent":
			summary.MemoryPercent = metricSummary
		case "disk_percent":
			summary.DiskPercent = metricSummary
		case "network_in_bps":
			summary.NetworkInBPS = metricSummary
		case "network_out_bps":
			summary.NetworkOutBPS = metricSummary
		}
	}
	out := make([]contracts.PlatformResourceTrendSummary, 0, len(platformDashboardServerResources))
	for _, server := range platformDashboardServerResources {
		summary := *byServer[server.ID]
		if platformResourceTrendSummaryEmpty(summary) && (fallbackStatus == platformDashboardSourceConfigured || fallbackStatus == platformDashboardSourceEmpty) {
			summary.SourceStatus = platformDashboardSourceUnmonitored
		}
		out = append(out, summary)
	}
	return out
}

func platformResourceTrendSummaryEmpty(summary contracts.PlatformResourceTrendSummary) bool {
	return summary.CPUPercent.Current == nil &&
		summary.MemoryPercent.Current == nil &&
		summary.DiskPercent.Current == nil &&
		summary.NetworkInBPS.Current == nil &&
		summary.NetworkOutBPS.Current == nil
}

func platformResourceMetricSummary(points []contracts.PlatformResourceTrendPoint) contracts.PlatformResourceMetricSummary {
	if len(points) == 0 {
		return contracts.PlatformResourceMetricSummary{}
	}
	values := make([]float64, 0, len(points))
	var sum float64
	for _, point := range points {
		values = append(values, point.Value)
		sum += point.Value
	}
	sort.Float64s(values)
	current := toTwoDecimal(points[len(points)-1].Value)
	avg := toTwoDecimal(sum / float64(len(points)))
	p95 := toTwoDecimal(percentile(values, 0.95))
	maximum := toTwoDecimal(values[len(values)-1])
	return contracts.PlatformResourceMetricSummary{
		Current: &current,
		Avg:     &avg,
		P95:     &p95,
		Max:     &maximum,
	}
}

func percentile(sortedValues []float64, quantile float64) float64 {
	if len(sortedValues) == 0 {
		return 0
	}
	if len(sortedValues) == 1 {
		return sortedValues[0]
	}
	index := quantile * float64(len(sortedValues)-1)
	lower := int(math.Floor(index))
	upper := int(math.Ceil(index))
	if lower == upper {
		return sortedValues[lower]
	}
	weight := index - float64(lower)
	return sortedValues[lower]*(1-weight) + sortedValues[upper]*weight
}

func platformResourceTrendUnit(metric string) string {
	if strings.HasSuffix(metric, "_bps") {
		return "bps"
	}
	return "percent"
}

func platformDashboardServerResourceSourceStatus(queries ...contracts.PlatformDashboardPrometheusQuery) string {
	status := combinedPrometheusQueryStatus(queries...)
	if status == "" {
		return platformDashboardSourceUnconfigured
	}
	return status
}

func platformDashboardServerResourceStatus(row contracts.PlatformDashboardServerResource) string {
	if resourceMetricAtLeast(row.CPUPercent, 85) || resourceMetricAtLeast(row.MemoryPercent, 90) || resourceMetricAtLeast(row.DiskPercent, 90) {
		return "critical"
	}
	if resourceMetricAtLeast(row.CPUPercent, 70) || resourceMetricAtLeast(row.MemoryPercent, 75) || resourceMetricAtLeast(row.DiskPercent, 75) {
		return "warning"
	}
	return "ok"
}

func resourceMetricAtLeast(value *float64, threshold float64) bool {
	return value != nil && *value >= threshold
}

func prometheusSeriesValueForRole(query contracts.PlatformDashboardPrometheusQuery, role string) *float64 {
	for _, series := range query.Series {
		if strings.EqualFold(series.Labels["role"], role) {
			value := toTwoDecimal(series.Value)
			return &value
		}
	}
	return nil
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

func sumPrometheusSeriesForExporter(query contracts.PlatformDashboardPrometheusQuery, services []string, roles []string) float64 {
	serviceSet := lowerStringSet(services)
	roleSet := lowerStringSet(roles)
	var total float64
	for _, series := range query.Series {
		service := strings.ToLower(series.Labels["service"])
		role := strings.ToLower(series.Labels["role"])
		if serviceSet[service] || roleSet[role] {
			total += series.Value
		}
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
	case job == "node" || strings.HasSuffix(job, "_node"):
		return "host"
	case job == "postgres" || job == "redis":
		return "data"
	case job == "emqx" || role == "mqtt":
		return "broker"
	case job == "nginx" || role == "edge" || role == "gateway":
		return "gateway"
	default:
		return "app"
	}
}

func platformDashboardExporterStatus(row contracts.PlatformDashboardServiceExporter) string {
	switch {
	case row.SourceStatus == platformDashboardSourceUnconfigured || row.SourceStatus == platformDashboardSourceUnavailable:
		return row.SourceStatus
	case row.SourceStatus == platformDashboardSourceEmpty || row.TargetsTotal == 0:
		return platformDashboardSourceUnmonitored
	case row.TargetsDown > 0:
		return "degraded"
	default:
		return "ok"
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

func lowerStringSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[strings.ToLower(value)] = true
	}
	return out
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

func (c prometheusClient) queryRange(ctx context.Context, def prometheusQueryDefinition, start, end time.Time, step time.Duration) ([]contracts.PlatformResourceTrendSeries, error) {
	if !c.configured() {
		return nil, errors.New("prometheus is not configured")
	}
	endpoint, err := url.Parse(c.baseURL + "/api/v1/query_range")
	if err != nil {
		return nil, err
	}
	query := endpoint.Query()
	query.Set("query", def.Query)
	query.Set("start", start.Format(time.RFC3339))
	query.Set("end", end.Format(time.RFC3339))
	query.Set("step", strconv.FormatInt(int64(step.Seconds()), 10))
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("prometheus query_range failed with status %d", resp.StatusCode)
	}
	var body prometheusQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Status != "success" || body.Data.ResultType != "matrix" {
		return nil, errors.New("prometheus returned an unsupported range response")
	}

	out := []contracts.PlatformResourceTrendSeries{}
	for _, item := range body.Data.Result {
		server, ok := platformDashboardServerForNodeRole(item.Metric["role"])
		if !ok {
			continue
		}
		points := item.floatPoints()
		if len(points) == 0 {
			continue
		}
		out = append(out, contracts.PlatformResourceTrendSeries{
			ServerID:     server.ID,
			Label:        server.Label,
			Role:         server.Role,
			Metric:       def.ID,
			Unit:         platformResourceTrendUnit(def.ID),
			SourceStatus: platformDashboardSourceConfigured,
			Points:       points,
		})
	}
	return out, nil
}

func platformDashboardServerForNodeRole(role string) (struct {
	ID       string
	Label    string
	Role     string
	NodeRole string
}, bool) {
	for _, server := range platformDashboardServerResources {
		if strings.EqualFold(server.NodeRole, role) {
			return server, true
		}
	}
	return struct {
		ID       string
		Label    string
		Role     string
		NodeRole string
	}{}, false
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
	Values [][]any           `json:"values"`
}

func (v prometheusVectorItem) floatValue() (float64, bool) {
	if len(v.Value) < 2 {
		return 0, false
	}
	switch value := v.Value[1].(type) {
	case string:
		parsed, err := strconv.ParseFloat(value, 64)
		return finitePrometheusValue(parsed, err == nil)
	case float64:
		return finitePrometheusValue(value, true)
	default:
		return 0, false
	}
}

func (v prometheusVectorItem) floatPoints() []contracts.PlatformResourceTrendPoint {
	points := []contracts.PlatformResourceTrendPoint{}
	for _, item := range v.Values {
		if len(item) < 2 {
			continue
		}
		timestamp, ok := prometheusTimestamp(item[0])
		if !ok {
			continue
		}
		value, ok := prometheusSampleValue(item[1])
		if !ok {
			continue
		}
		points = append(points, contracts.PlatformResourceTrendPoint{
			Timestamp: timestamp.UTC().Format(time.RFC3339),
			Value:     toTwoDecimal(value),
		})
	}
	return points
}

func prometheusTimestamp(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case float64:
		seconds, fraction := math.Modf(typed)
		return time.Unix(int64(seconds), int64(fraction*1e9)), true
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return time.Time{}, false
		}
		seconds, fraction := math.Modf(parsed)
		return time.Unix(int64(seconds), int64(fraction*1e9)), true
	default:
		return time.Time{}, false
	}
}

func prometheusSampleValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return finitePrometheusValue(parsed, err == nil)
	case float64:
		return finitePrometheusValue(typed, true)
	default:
		return 0, false
	}
}

func finitePrometheusValue(value float64, ok bool) (float64, bool) {
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}
