package app

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/contracts"
	"rtk_cloud_admin/internal/videoclient"
)

const fleetAnalyticsBatchSize = 500

type fleetOverviewBatch struct {
	presence    videoclient.FleetPresenceSummary
	health      videoclient.FleetHealthSummary
	stream      videoclient.FleetStreamStats
	presenceErr error
	healthErr   error
	streamErr   error
}

func (s *Server) apiFleetOverview(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, accountDevices, err := s.customerAuthorizedFleetDevices(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if !hasAnyCapability(org.Capabilities, capabilityFleetRead, capabilityCustomerDevicesRead) {
		http.Error(w, "fleet read permission required", http.StatusForbidden)
		return
	}
	devices := eligibleFleetAnalyticsDevices(accountDevices)
	asOf := time.Now().UTC()
	overview := contracts.FleetOverview{CloudID: org.ID, AsOf: asOf.Format(time.RFC3339Nano)}
	overview.Scope.DeviceCount = len(devices)
	overview.Presence.Trend = []contracts.FleetPresenceTrendPoint{}
	overview.Presence.Source = contracts.FleetMetricSource{Status: "unavailable", Message: "Fleet presence source is not configured."}
	overview.Health.Source = contracts.FleetMetricSource{Status: "unavailable", Message: "Fleet health source is not configured."}
	overview.Sessions.Source = contracts.FleetMetricSource{Status: "unavailable", Message: "WebRTC session source is not configured."}
	w.Header().Set("Cache-Control", "no-store")
	if !s.videoClient.Enabled() || s.videoCloudFleetReadToken() == "" {
		writeJSON(w, overview)
		return
	}

	batches := chunkStrings(videoCloudDeviceIDs(accountDevicesToContracts(org, devices)), fleetAnalyticsBatchSize)
	if len(batches) == 0 {
		batches = [][]string{{}}
	}
	results := make([]fleetOverviewBatch, len(batches))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, batch := range batches {
		i, batch := i, append([]string(nil), batch...)
		wg.Add(3)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i].presence, results[i].presenceErr = s.videoClient.FleetPresenceSummaryAt(r.Context(), s.videoCloudFleetReadToken(), org.ID, batch, asOf)
		}()
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i].health, results[i].healthErr = s.videoClient.FleetHealthSummaryScopedAt(r.Context(), s.videoCloudFleetReadToken(), org.ID, batch, asOf)
		}()
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i].stream, results[i].streamErr = s.videoClient.FleetStreamStatsAt(r.Context(), s.videoCloudFleetReadToken(), org.ID, "7d", batch, asOf)
		}()
	}
	wg.Wait()
	aggregateFleetOverview(&overview, results)
	writeJSON(w, overview)
}

func (s *Server) apiFleetAttention(w http.ResponseWriter, r *http.Request) {
	session, ok := s.requestSession(r)
	if !ok || session.Kind != "customer" {
		http.Error(w, "customer authentication required", http.StatusUnauthorized)
		return
	}
	org, accountDevices, err := s.customerAuthorizedFleetDevices(r.Context(), session)
	if err != nil {
		s.writeCustomerErrorForSession(w, session.ID, err)
		return
	}
	if !hasAnyCapability(org.Capabilities, capabilityFleetRead, capabilityCustomerDevicesRead) {
		http.Error(w, "fleet read permission required", http.StatusForbidden)
		return
	}
	offset, limit, err := parseFleetAttentionPagination(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	asOf := time.Now().UTC()
	response := contracts.FleetAttentionPage{CloudID: org.ID, AsOf: asOf.Format(time.RFC3339Nano), Items: []contracts.FleetAttentionItem{}, Source: contracts.FleetMetricSource{Status: "unavailable", Message: "Fleet health source is not configured."}}
	response.Pagination = contracts.FleetPagination{Limit: limit, Offset: offset}
	w.Header().Set("Cache-Control", "no-store")
	if !s.videoClient.Enabled() || s.videoCloudFleetReadToken() == "" {
		writeJSON(w, response)
		return
	}
	devices := eligibleFleetAnalyticsDevices(accountDevices)
	batches := chunkStrings(videoCloudDeviceIDs(accountDevicesToContracts(org, devices)), fleetAnalyticsBatchSize)
	if len(batches) == 0 {
		response.Source = contracts.FleetMetricSource{Status: "available"}
		writeJSON(w, response)
		return
	}
	all := make([]videoclient.FleetAttentionItem, 0)
	for _, batch := range batches {
		items, fetchErr := s.fetchFleetAttentionBatch(r.Context(), org.ID, batch, asOf)
		if fetchErr != nil {
			response.Source = contracts.FleetMetricSource{Status: "partial", Message: "Some health detail batches are unavailable."}
			continue
		}
		all = append(all, items...)
		if response.Source.Status != "partial" {
			response.Source = contracts.FleetMetricSource{Status: "available"}
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].State != all[j].State {
			return all[i].State == "critical"
		}
		if !all[i].ObservedAt.Equal(all[j].ObservedAt) {
			return all[i].ObservedAt.After(all[j].ObservedAt)
		}
		return all[i].DeviceID < all[j].DeviceID
	})
	response.Pagination.Total = len(all)
	if offset > len(all) {
		offset = len(all)
	}
	end := offset + limit
	if end > len(all) {
		end = len(all)
	}
	for _, item := range all[offset:end] {
		response.Items = append(response.Items, contracts.FleetAttentionItem{DeviceID: item.DeviceID, AccountDeviceID: item.AccountDeviceID, DeviceName: item.DeviceName, State: item.State, Reason: item.Reason, ObservedAt: item.ObservedAt.UTC().Format(time.RFC3339Nano)})
	}
	writeJSON(w, response)
}

func (s *Server) fetchFleetAttentionBatch(ctx context.Context, orgID string, devices []string, asOf time.Time) ([]videoclient.FleetAttentionItem, error) {
	items := []videoclient.FleetAttentionItem{}
	for offset := 0; ; offset += 100 {
		page, err := s.videoClient.FleetHealthAttentionAt(ctx, s.videoCloudFleetReadToken(), orgID, devices, offset, 100, asOf)
		if err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if len(page.Items) == 0 || offset+len(page.Items) >= page.Pagination.Total {
			return items, nil
		}
	}
}

func eligibleFleetAnalyticsDevices(devices []accountclient.Device) []accountclient.Device {
	out := make([]accountclient.Device, 0, len(devices))
	for _, dev := range devices {
		dev.VideoCloudDevID = fallback(dev.VideoCloudDevID, metadataString(dev.Metadata, "video_cloud_devid", ""))
		dev.Status = fallback(dev.Status, metadataString(dev.Metadata, "status", "unknown"))
		dev.Readiness = fallback(dev.Readiness, metadataString(dev.Metadata, "readiness", ""))
		status := strings.ToLower(strings.TrimSpace(dev.Status))
		readiness := strings.ToLower(strings.TrimSpace(dev.Readiness))
		if strings.TrimSpace(dev.VideoCloudDevID) == "" || status == "disabled" || status == "deactivated" || status == "unprovisioned" || readiness == "disabled" || readiness == "deactivated" || readiness == "activation_pending" || readiness == "activation_failed" {
			continue
		}
		out = append(out, dev)
	}
	return out
}

func accountDevicesToContracts(org accountclient.Organization, devices []accountclient.Device) []contracts.Device {
	out := make([]contracts.Device, 0, len(devices))
	for _, dev := range devices {
		out = append(out, mapUpstreamDevice(org, dev, nil))
	}
	return out
}

func chunkStrings(values []string, size int) [][]string {
	if size < 1 {
		size = fleetAnalyticsBatchSize
	}
	out := make([][]string, 0, (len(values)+size-1)/size)
	for len(values) > 0 {
		n := size
		if n > len(values) {
			n = len(values)
		}
		out = append(out, values[:n])
		values = values[n:]
	}
	return out
}

func aggregateFleetOverview(out *contracts.FleetOverview, batches []fleetOverviewBatch) {
	trend := map[string]*contracts.FleetPresenceTrendPoint{}
	healthTrend := map[string]*contracts.FleetHealthDaily{}
	presenceOK, healthOK, streamOK := 0, 0, 0
	presenceDegraded, healthDegraded := false, false
	activeSessions := 0
	for _, batch := range batches {
		if batch.presenceErr == nil {
			if usable, degraded := fleetMetricSourceUsable(batch.presence.SourceStatus); usable {
				presenceOK++
				presenceDegraded = presenceDegraded || degraded
			}
			out.Presence.Current.Online += batch.presence.Current.Online
			out.Presence.Current.Offline += batch.presence.Current.Offline
			out.Presence.Current.Unknown += batch.presence.Current.Unknown
			out.Presence.Current.Total += batch.presence.Current.Total
			out.Presence.OnlineSeconds += batch.presence.History.OnlineSeconds
			out.Presence.OfflineSeconds += batch.presence.History.OfflineSeconds
			out.Presence.KnownSeconds += batch.presence.History.KnownSeconds
			out.Presence.ExpectedSeconds += batch.presence.History.ExpectedSeconds
			for _, point := range batch.presence.History.Trend {
				current := trend[point.Date]
				if current == nil {
					current = &contracts.FleetPresenceTrendPoint{Date: point.Date}
					trend[point.Date] = current
				}
				current.OnlineSeconds += point.OnlineSeconds
				current.OfflineSeconds += point.OfflineSeconds
				current.KnownSeconds += point.KnownSeconds
				current.ExpectedSeconds += point.ExpectedSeconds
			}
		}
		if batch.healthErr == nil {
			if usable, degraded := fleetMetricSourceUsable(batch.health.SourceStatus); usable {
				healthOK++
				healthDegraded = healthDegraded || degraded
			}
			out.Health.Healthy += batch.health.Distribution.Healthy
			out.Health.Warning += batch.health.Distribution.Warning
			out.Health.Critical += batch.health.Distribution.Critical
			out.Health.Unknown += batch.health.Distribution.Unknown
			out.Health.Stale += batch.health.Distribution.Stale
			for _, point := range batch.health.Trend7D {
				current := healthTrend[point.Date]
				if current == nil {
					current = &contracts.FleetHealthDaily{Date: point.Date}
					healthTrend[point.Date] = current
				}
				current.Healthy += point.Healthy
				current.Warning += point.Warning
				current.Critical += point.Critical
				current.Unknown += point.Unknown
			}
		}
		if batch.streamErr == nil {
			streamOK++
			activeSessions += batch.stream.ActiveSessions
		}
	}
	out.Presence.OnlineRate7dPct = fleetPercent(out.Presence.OnlineSeconds, out.Presence.KnownSeconds)
	out.Presence.Coverage7dPct = fleetPercent(out.Presence.KnownSeconds, out.Presence.ExpectedSeconds)
	for _, point := range trend {
		point.OnlineRatePct = fleetPercent(point.OnlineSeconds, point.KnownSeconds)
		point.CoveragePct = fleetPercent(point.KnownSeconds, point.ExpectedSeconds)
		out.Presence.Trend = append(out.Presence.Trend, *point)
	}
	sort.Slice(out.Presence.Trend, func(i, j int) bool { return out.Presence.Trend[i].Date < out.Presence.Trend[j].Date })
	for _, point := range healthTrend {
		out.Health.Trend = append(out.Health.Trend, *point)
	}
	sort.Slice(out.Health.Trend, func(i, j int) bool { return out.Health.Trend[i].Date < out.Health.Trend[j].Date })
	out.Health.NeedsAttention = out.Health.Warning + out.Health.Critical
	out.Presence.Source = batchSource(presenceOK, len(batches), "Fleet presence data is partially unavailable.")
	out.Health.Source = batchSource(healthOK, len(batches), "Fleet health data is partially unavailable.")
	out.Sessions.Source = batchSource(streamOK, len(batches), "WebRTC session data is partially unavailable.")
	if presenceDegraded {
		out.Presence.Source.Status = "partial"
		out.Presence.Source.Message = "Some fleet presence data is stale or partially available."
	}
	if healthDegraded {
		out.Health.Source.Status = "partial"
		out.Health.Source.Message = "Some fleet health data is stale or partially available."
	}
	if streamOK > 0 {
		out.Sessions.ActiveSessions = &activeSessions
	}
}

func fleetMetricSourceUsable(status string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "available", "configured", "ok":
		return true, false
	case "partial", "stale", "degraded":
		return true, true
	default:
		return false, false
	}
}

func batchSource(success, total int, partialMessage string) contracts.FleetMetricSource {
	if success == total {
		return contracts.FleetMetricSource{Status: "available"}
	}
	if success > 0 {
		return contracts.FleetMetricSource{Status: "partial", Message: partialMessage}
	}
	return contracts.FleetMetricSource{Status: "unavailable", Message: partialMessage}
}

func fleetPercent(numerator, denominator int64) *float64 {
	if denominator <= 0 {
		return nil
	}
	value := math.Round(float64(numerator)*10000/float64(denominator)) / 100
	return &value
}

func parseFleetAttentionPagination(r *http.Request) (int, int, error) {
	offset, limit := 0, 50
	var err error
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return 0, 0, errInvalidPagination
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, errInvalidPagination
		}
	}
	return offset, limit, nil
}

func (s *Server) videoCloudFleetReadToken() string {
	return strings.TrimSpace(firstNonEmpty(s.cfg.VideoCloudFleetReadToken, s.cfg.VideoCloudAdminToken))
}

var errInvalidPagination = &fleetPaginationError{}

type fleetPaginationError struct{}

func (*fleetPaginationError) Error() string { return "invalid pagination" }
