package app

import (
	"errors"
	"net/http"

	"rtk_cloud_admin/internal/accountclient"
	"rtk_cloud_admin/internal/correlation"
	"rtk_cloud_admin/internal/videoclient"

	"go.uber.org/zap"
)

func requestContextMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		values := correlation.FromRequest(r)
		r.Header.Set(correlation.HeaderRequestID, values.RequestID)
		if values.TraceID != "" {
			r.Header.Set(correlation.HeaderTraceID, values.TraceID)
		}
		if values.OperationID != "" {
			r.Header.Set(correlation.HeaderOperationID, values.OperationID)
		}
		w.Header().Set(correlation.HeaderRequestID, values.RequestID)
		next.ServeHTTP(w, r.WithContext(correlation.With(r.Context(), values)))
	})
}

func (s *Server) logUpstreamError(upstream string, err error) {
	if s.logger == nil || err == nil {
		return
	}
	fields := []zap.Field{
		zap.String("upstream", upstream),
		zap.String("error_category", upstreamErrorCategory(err)),
		zap.String("error", safeUpstreamError(err)),
	}
	var accountErr *accountclient.HTTPError
	if errors.As(err, &accountErr) {
		fields = append(fields,
			zap.String("method", accountErr.Method),
			zap.String("path", accountErr.Path),
			zap.Int("status", accountErr.StatusCode),
		)
	}
	var videoErr videoclient.HTTPStatusError
	if errors.As(err, &videoErr) {
		fields = append(fields, zap.Int("status", videoErr.StatusCode))
	}
	s.logger.Warn("upstream request failed", fields...)
}

func upstreamErrorCategory(err error) string {
	if isTimeoutError(err) {
		return "timeout"
	}
	var accountErr *accountclient.HTTPError
	if errors.As(err, &accountErr) {
		return "http_status"
	}
	var videoErr videoclient.HTTPStatusError
	if errors.As(err, &videoErr) {
		return "http_status"
	}
	return "request_failed"
}

func safeUpstreamError(err error) string {
	var accountErr *accountclient.HTTPError
	if errors.As(err, &accountErr) {
		return "account manager request failed"
	}
	var videoErr videoclient.HTTPStatusError
	if errors.As(err, &videoErr) {
		return "video cloud request failed"
	}
	if isTimeoutError(err) {
		return "upstream request timed out"
	}
	return "upstream request failed"
}
