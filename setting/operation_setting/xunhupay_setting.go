package operation_setting

import (
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// DefaultXunhuPayGateway is the official XunhuPay (虎皮椒) payment endpoint.
// Callers must use this URL as-is. The Epay client appends submit.php, which
// 虎皮椒 does not serve.
const DefaultXunhuPayGateway = "https://api.xunhupay.com/payment/do.html"

const xunhuPayGatewayError = "XunhuPay gateway URL must end with /payment/do.html and must not use submit.php."

var XunhuPayGateway = DefaultXunhuPayGateway
var XunhuPayWechatAppId = ""
var XunhuPayWechatAppSecret = ""
var XunhuPayAlipayAppId = ""
var XunhuPayAlipayAppSecret = ""

// NormalizeXunhuPayGateway returns the gateway URL that payment requests post to.
// An empty value uses the official endpoint. The path is never rewritten, so
// submit.php is not appended.
func NormalizeXunhuPayGateway(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		trimmed = DefaultXunhuPayGateway
	}
	trimmed = strings.TrimRight(trimmed, "/")
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return "", common.NewMessage(xunhuPayGatewayError)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", common.NewMessage(xunhuPayGatewayError)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", common.NewMessage(xunhuPayGatewayError)
	}
	path := strings.ToLower(parsed.EscapedPath())
	if strings.Contains(path, "submit.php") || !strings.HasSuffix(path, "/payment/do.html") {
		return "", common.NewMessage(xunhuPayGatewayError)
	}
	return trimmed, nil
}
