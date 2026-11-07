package controller

import (
	"bytes"
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/shopspring/decimal"
)

const xunhuPayVersion = "1.1"

var xunhuPayClient = &http.Client{Timeout: 20 * time.Second}

type xunhuPayChannel struct {
	method string
	appID  string
	secret string
}

type xunhuPayRequest struct {
	Amount        int64  `json:"amount"`
	PaymentMethod string `json:"payment_method"`
}

func xunhuPayReadyChannels() []xunhuPayChannel {
	if _, err := operation_setting.NormalizeXunhuPayGateway(operation_setting.XunhuPayGateway); err != nil {
		return nil
	}
	candidates := []xunhuPayChannel{
		{
			method: model.PaymentMethodXunhuPayWechat,
			appID:  strings.TrimSpace(operation_setting.XunhuPayWechatAppId),
			secret: strings.TrimSpace(operation_setting.XunhuPayWechatAppSecret),
		},
		{
			method: model.PaymentMethodXunhuPayAlipay,
			appID:  strings.TrimSpace(operation_setting.XunhuPayAlipayAppId),
			secret: strings.TrimSpace(operation_setting.XunhuPayAlipayAppSecret),
		},
	}
	ready := make([]xunhuPayChannel, 0, len(candidates))
	for _, channel := range candidates {
		if channel.appID != "" && channel.secret != "" {
			ready = append(ready, channel)
		}
	}
	return ready
}

func xunhuPayChannelByMethod(method string) (xunhuPayChannel, bool) {
	for _, channel := range xunhuPayReadyChannels() {
		if channel.method == method {
			return channel, true
		}
	}
	return xunhuPayChannel{}, false
}

// xunhuPayHash is the 虎皮椒 MD5 signature: sorted non-empty key=value pairs
// with the AppSecret appended and no separator. MD5 is required by the gateway.
func xunhuPayHash(fields map[string]string, appSecret string) string {
	keys := make([]string, 0, len(fields))
	for key, value := range fields {
		if key == "hash" || value == "" {
			continue
		}
		keys = append(keys, key)
	}
	slices.Sort(keys)
	var builder strings.Builder
	for _, key := range keys {
		if builder.Len() > 0 {
			builder.WriteByte('&')
		}
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(fields[key])
	}
	builder.WriteString(appSecret)
	sum := md5.Sum([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}

func xunhuPayHashEqual(expected string, actual string) bool {
	if len(expected) != len(actual) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func xunhuPayAbsoluteURL(base string, path string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(base), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", common.NewMessage("Server address is not configured")
	}
	absolute := trimmed + path
	if len(absolute) > 128 {
		return "", common.NewMessage("XunhuPay notify URL is too long")
	}
	return absolute, nil
}

func xunhuPayHTTPSURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

func xunhuPayJSONFields(raw map[string]common.RawMessage) map[string]string {
	fields := make(map[string]string, len(raw))
	for key, value := range raw {
		text := bytes.TrimSpace(value)
		if len(text) == 0 || bytes.Equal(text, []byte("null")) {
			continue
		}
		if text[0] == '"' {
			var decoded string
			if err := common.Unmarshal(text, &decoded); err != nil {
				continue
			}
			fields[key] = decoded
			continue
		}
		fields[key] = string(text)
	}
	return fields
}

func xunhuPayCallbackParams(c *gin.Context) (map[string]string, error) {
	if c.Request.Method == http.MethodPost {
		if err := c.Request.ParseForm(); err != nil {
			return nil, err
		}
		return lo.Reduce(lo.Keys(c.Request.PostForm), func(fields map[string]string, key string, _ int) map[string]string {
			fields[key] = c.Request.PostForm.Get(key)
			return fields
		}, map[string]string{}), nil
	}
	return lo.Reduce(lo.Keys(c.Request.URL.Query()), func(fields map[string]string, key string, _ int) map[string]string {
		fields[key] = c.Request.URL.Query().Get(key)
		return fields
	}, map[string]string{}), nil
}

func xunhuPayVerifiedChannel(params map[string]string) (xunhuPayChannel, bool) {
	appID := strings.TrimSpace(params["appid"])
	if appID == "" {
		return xunhuPayChannel{}, false
	}
	for _, channel := range xunhuPayReadyChannels() {
		if channel.appID != appID {
			continue
		}
		if xunhuPayHashEqual(xunhuPayHash(params, channel.secret), params["hash"]) {
			return channel, true
		}
	}
	return xunhuPayChannel{}, false
}

func newXunhuTradeNo(userID int) (string, error) {
	tradeNo := fmt.Sprintf("X%d%s", userID, common.GetRandomString(8))
	if len(tradeNo) > 32 {
		return "", common.NewMessage("Failed to create order")
	}
	return tradeNo, nil
}

func RequestXunhuPay(c *gin.Context) {
	if !isXunhuPayTopUpEnabled() {
		paymentError(c, common.NewMessage("Payment information has not been configured by administrator"))
		return
	}
	var req xunhuPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	if req.Amount < getMinTopup() {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": getMinTopup()}))
		return
	}
	userID := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, userID, req.Amount) {
		return
	}
	channel, ok := xunhuPayChannelByMethod(req.PaymentMethod)
	if !ok {
		paymentError(c, common.NewMessage("XunhuPay payment method is not enabled"))
		return
	}
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}
	payMoney := getPayMoney(req.Amount, group)
	if payMoney < 0.01 {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return
	}
	gateway, err := operation_setting.NormalizeXunhuPayGateway(operation_setting.XunhuPayGateway)
	if err != nil {
		paymentError(c, common.NewMessage("Payment information has not been configured by administrator"))
		return
	}
	notifyURL, err := xunhuPayAbsoluteURL(service.GetCallbackAddress(), "/api/user/xunhupay/notify")
	if err != nil {
		paymentError(c, err)
		return
	}
	tradeNo, err := newXunhuTradeNo(userID)
	if err != nil {
		paymentError(c, err)
		return
	}
	totalFee := strconv.FormatFloat(payMoney, 'f', 2, 64)
	params := map[string]string{
		"version":        xunhuPayVersion,
		"appid":          channel.appID,
		"trade_order_id": tradeNo,
		"total_fee":      totalFee,
		"title":          fmt.Sprintf("Topup%d", req.Amount),
		"time":           fmt.Sprintf("%d", time.Now().Unix()),
		"notify_url":     notifyURL,
		"nonce_str":      common.GetRandomString(16),
		"plugins":        "wallet-topup",
	}
	if returnURL, returnErr := xunhuPayAbsoluteURL(system_setting.ServerAddress, "/wallet"); returnErr == nil {
		params["return_url"] = returnURL
		params["callback_url"] = returnURL
	}
	params["hash"] = xunhuPayHash(params, channel.secret)

	body, err := common.Marshal(params)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, gateway, bytes.NewReader(body))
	if err != nil {
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := xunhuPayClient.Do(httpReq)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("XunhuPay failed to start payment user_id=%d trade_no=%s payment_method=%s amount=%d error=%q", userID, tradeNo, req.PaymentMethod, req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		logger.LogError(c.Request.Context(), common.LogText("XunhuPay gateway request failed user_id=%d trade_no=%s status=%d", userID, tradeNo, resp.StatusCode))
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	var raw map[string]common.RawMessage
	if err := common.Unmarshal(respBody, &raw); err != nil {
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	fields := xunhuPayJSONFields(raw)
	if !xunhuPayHashEqual(xunhuPayHash(fields, channel.secret), fields["hash"]) {
		logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay gateway response signature mismatch user_id=%d trade_no=%s", userID, tradeNo))
		paymentError(c, common.NewMessage("Payment gateway response could not be verified"))
		return
	}
	if fields["errcode"] != "0" {
		errmsg := strings.TrimSpace(fields["errmsg"])
		if len(errmsg) > 200 {
			errmsg = errmsg[:200]
		}
		logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay gateway rejected payment user_id=%d trade_no=%s errcode=%s errmsg=%q", userID, tradeNo, fields["errcode"], errmsg))
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}
	payURL := xunhuPayHTTPSURL(fields["url"])
	qrURL := xunhuPayHTTPSURL(fields["url_qrcode"])
	if payURL == "" && qrURL == "" {
		paymentError(c, common.NewMessage("Failed to start XunhuPay payment"))
		return
	}

	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}
	money, err := decimal.NewFromString(totalFee)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	topUp := &model.TopUp{
		UserId:          userID,
		Amount:          amount,
		Money:           money.InexactFloat64(),
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderXunhuPay,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("XunhuPay failed to create top-up order user_id=%d trade_no=%s payment_method=%s amount=%d error=%q", userID, tradeNo, req.PaymentMethod, req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("XunhuPay top-up order created user_id=%d trade_no=%s payment_method=%s amount=%d money=%s", userID, tradeNo, req.PaymentMethod, req.Amount, totalFee))
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"url":        payURL,
			"url_qrcode": qrURL,
		},
	})
}

func XunhuPayNotify(c *gin.Context) {
	if !isXunhuPayWebhookEnabled() {
		logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay webhook rejected reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	params, err := xunhuPayCallbackParams(c)
	if err != nil || len(params) == 0 || params["hash"] == "" {
		logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay webhook params are invalid path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	channel, ok := xunhuPayVerifiedChannel(params)
	if !ok {
		logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay webhook signature verification failed path=%q client_ip=%s trade_no=%s", c.Request.RequestURI, c.ClientIP(), params["trade_order_id"]))
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	tradeNo := params["trade_order_id"]
	if params["status"] != "OD" {
		logger.LogInfo(c.Request.Context(), common.LogText("XunhuPay webhook ignored event trade_no=%s status=%s client_ip=%s", tradeNo, params["status"], c.ClientIP()))
		_, _ = c.Writer.Write([]byte("success"))
		return
	}
	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	alreadyDone, err := model.RechargeXunhuPay(tradeNo, params["total_fee"], channel.method, c.ClientIP())
	if err != nil {
		switch {
		case errors.Is(err, model.ErrTopUpNotFound):
			logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay callback order not found trade_no=%s client_ip=%s", tradeNo, c.ClientIP()))
		case errors.Is(err, model.ErrPaymentMethodMismatch):
			logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay order payment channel mismatch trade_no=%s payment_method=%s client_ip=%s", tradeNo, channel.method, c.ClientIP()))
		case errors.Is(err, model.ErrXunhuPayAmountMismatch):
			logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay callback amount mismatch trade_no=%s total_fee=%s client_ip=%s", tradeNo, params["total_fee"], c.ClientIP()))
		case errors.Is(err, model.ErrTopUpStatusInvalid):
			logger.LogWarn(c.Request.Context(), common.LogText("XunhuPay order status invalid trade_no=%s client_ip=%s", tradeNo, c.ClientIP()))
		default:
			logger.LogError(c.Request.Context(), common.LogText("XunhuPay top-up processing failed trade_no=%s client_ip=%s error=%q", tradeNo, c.ClientIP(), err.Error()))
		}
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if alreadyDone {
		logger.LogInfo(c.Request.Context(), common.LogText("XunhuPay duplicate callback ignored trade_no=%s client_ip=%s", tradeNo, c.ClientIP()))
	} else {
		logger.LogInfo(c.Request.Context(), common.LogText("XunhuPay top-up succeeded trade_no=%s payment_method=%s client_ip=%s", tradeNo, channel.method, c.ClientIP()))
	}
	_, _ = c.Writer.Write([]byte("success"))
}
