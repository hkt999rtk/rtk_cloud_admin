package accountclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type ServiceApplyBlocker struct {
	DeviceID string `json:"device_id"`
	Code     string `json:"code"`
}

type ServiceApplyPreview struct {
	PreviewToken   string                `json:"preview_token"`
	TargetRevision int64                 `json:"target_revision"`
	TargetDigest   string                `json:"target_digest"`
	TotalDevices   int                   `json:"total_devices"`
	AddedCount     int                   `json:"added_count"`
	RemovedCount   int                   `json:"removed_count"`
	AddedOptions   []string              `json:"added_options"`
	RemovedOptions []string              `json:"removed_options"`
	Blockers       []ServiceApplyBlocker `json:"blockers"`
}

type ServiceApplyJob struct {
	ID             string    `json:"id"`
	TargetRevision int64     `json:"target_revision"`
	TargetDigest   string    `json:"target_digest"`
	TotalDevices   int       `json:"total_devices"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

type ServiceApplyItem struct {
	DeviceID         string `json:"device_id"`
	OperationID      string `json:"operation_id"`
	Status           string `json:"status"`
	BaselineRevision int64  `json:"baseline_revision"`
	BaselineDigest   string `json:"baseline_digest"`
	BaselineState    string `json:"baseline_state"`
	AppliedRevision  int64  `json:"applied_revision,omitempty"`
	FailureCode      string `json:"error_code,omitempty"`
	Retryable        bool   `json:"retryable,omitempty"`
}

type ServiceApplyItemPage struct {
	Items []ServiceApplyItem `json:"items"`
	Total int                `json:"total"`
}

func serviceApplyPath(cloud, product string) string {
	return "/v1/orgs/" + url.PathEscape(cloud) + "/device-item-profiles/" + url.PathEscape(product) + "/service-apply"
}

func (c *Client) ServiceApplyPreview(ctx context.Context, token, cloud, product string) (ServiceApplyPreview, error) {
	var out ServiceApplyPreview
	err := c.doJSON(ctx, http.MethodGet, serviceApplyPath(cloud, product)+"-preview", token, nil, &out)
	if err == nil && (out.PreviewToken == "" || out.TargetRevision < 1 || out.TotalDevices < 0) {
		err = fmt.Errorf("incomplete Product service apply preview")
	}
	return out, err
}

func (c *Client) CreateServiceApplyJob(ctx context.Context, token, cloud, product, jobID, previewToken string) (ServiceApplyJob, error) {
	var out struct {
		Job ServiceApplyJob `json:"job"`
	}
	err := c.doJSON(ctx, http.MethodPost, serviceApplyPath(cloud, product)+"-jobs", token, map[string]string{"job_id": jobID, "preview_token": previewToken}, &out)
	if err == nil && (out.Job.ID != jobID || out.Job.TargetRevision < 1 || out.Job.TotalDevices < 0 || out.Job.CreatedAt.IsZero()) {
		err = fmt.Errorf("incomplete Product service apply job")
	}
	return out.Job, err
}

func (c *Client) ServiceApplyJob(ctx context.Context, token, cloud, product, jobID string) (ServiceApplyJob, error) {
	var out struct {
		Job ServiceApplyJob `json:"job"`
	}
	err := c.doJSON(ctx, http.MethodGet, serviceApplyPath(cloud, product)+"-jobs/"+url.PathEscape(jobID), token, nil, &out)
	if err == nil && out.Job.ID != jobID {
		err = fmt.Errorf("invalid Product service apply job")
	}
	return out.Job, err
}

func (c *Client) ServiceApplyItems(ctx context.Context, token, cloud, product, jobID string, limit, offset int) (ServiceApplyItemPage, error) {
	var out ServiceApplyItemPage
	path := serviceApplyPath(cloud, product) + "-jobs/" + url.PathEscape(jobID) + "/items?limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
	err := c.doJSON(ctx, http.MethodGet, path, token, nil, &out)
	if err == nil && (out.Items == nil || out.Total < 0 || offset < 0 || len(out.Items) > limit || offset+len(out.Items) > out.Total) {
		err = fmt.Errorf("incomplete Product service apply items")
	}
	return out, err
}

func (c *Client) DispatchServiceApplyItem(ctx context.Context, token, cloud, product, jobID, deviceID string) error {
	path := serviceApplyPath(cloud, product) + "-jobs/" + url.PathEscape(jobID) + "/items/" + url.PathEscape(deviceID) + "/dispatch"
	return c.doJSON(ctx, http.MethodPost, path, token, map[string]any{}, nil)
}

func (c *Client) CancelServiceApplyJob(ctx context.Context, token, cloud, product, jobID string) error {
	path := serviceApplyPath(cloud, product) + "-jobs/" + url.PathEscape(jobID) + "/cancel"
	return c.doJSON(ctx, http.MethodPost, path, token, map[string]any{}, nil)
}

func (c *Client) CompleteServiceApplyJob(ctx context.Context, token, cloud, product, jobID string) error {
	path := serviceApplyPath(cloud, product) + "-jobs/" + url.PathEscape(jobID) + "/complete"
	return c.doJSON(ctx, http.MethodPost, path, token, map[string]any{}, nil)
}
