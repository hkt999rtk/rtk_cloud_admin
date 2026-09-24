package app

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
)

//go:embed localization.generated.json
var localizationJSON []byte

var localizedAPICopy = func() map[string]struct {
	System  map[string]string `json:"system"`
	Service map[string]string `json:"service"`
} {
	var copy map[string]struct {
		System  map[string]string `json:"system"`
		Service map[string]string `json:"service"`
	}
	if err := json.Unmarshal(localizationJSON, &copy); err != nil {
		panic(err)
	}
	return copy
}()

func preferredAPILocale(r *http.Request) string {
	values := []string{}
	if cookie, err := r.Cookie("rtk-console-locale"); err == nil {
		values = append(values, cookie.Value)
	}
	values = append(values, r.Header.Get("X-RTK-Locale"))
	values = append(values, strings.Split(r.Header.Get("Accept-Language"), ",")...)
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
		switch {
		case strings.HasPrefix(value, "zh-tw"), strings.HasPrefix(value, "zh-hant"):
			return "zh-TW"
		case strings.HasPrefix(value, "zh-cn"), strings.HasPrefix(value, "zh-hans"), value == "zh":
			return "zh-CN"
		case strings.HasPrefix(value, "en"):
			return "en"
		}
	}
	return "en"
}

func writeLocalizedJSON(w http.ResponseWriter, v any) error {
	locale := w.Header().Get("Content-Language")
	copy, supported := localizedAPICopy[locale]
	if !supported {
		return json.NewEncoder(w).Encode(v)
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var payload any
	if err := decoder.Decode(&payload); err != nil {
		return err
	}
	addLocalizedFields(payload, copy.System, copy.Service)
	return json.NewEncoder(w).Encode(payload)
}

func addLocalizedFields(value any, system, service map[string]string) {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			addLocalizedFields(child, system, service)
			text, ok := child.(string)
			if !ok || text == "" {
				continue
			}
			var translated string
			switch key {
			case "message", "source_message", "unavailable_reason", "error_description", "detail":
				translated = system[text]
			case "description", "summary", "role":
				translated = service[text]
			}
			if translated != "" && translated != text {
				item[key+"_localized"] = translated
			}
		}
	case []any:
		for _, child := range item {
			addLocalizedFields(child, system, service)
		}
	}
}
