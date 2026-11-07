package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestXunhuPayHashKnownVector(t *testing.T) {
	fields := map[string]string{
		"version":        "1.1",
		"appid":          "20146122002",
		"trade_order_id": "T1",
		"total_fee":      "1.00",
		"title":          "Topup1",
		"time":           "1522390464",
		"notify_url":     "https://example.com/api/user/xunhupay/notify",
		"nonce_str":      "abc",
		"hash":           "ignored",
		"empty":          "",
	}

	assert.Equal(t, "539c6ad23eccd039d345618f3e50681e", xunhuPayHash(fields, "secret"))
}

func TestNormalizeXunhuPayGatewayUsesExactDoHTMLURL(t *testing.T) {
	testCases := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "default", raw: "", want: operation_setting.DefaultXunhuPayGateway},
		{name: "official", raw: "https://api.xunhupay.com/payment/do.html", want: "https://api.xunhupay.com/payment/do.html"},
		{name: "backup platform", raw: "https://api.dpweixin.com/payment/do.html/", want: "https://api.dpweixin.com/payment/do.html"},
		{name: "submit.php", raw: "https://api.xunhupay.com/payment/submit.php", wantErr: true},
		{name: "submit.php suffix", raw: "https://api.xunhupay.com/payment/do.html/submit.php", wantErr: true},
		{name: "bare host", raw: "https://api.xunhupay.com", wantErr: true},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := operation_setting.NormalizeXunhuPayGateway(tc.raw)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
			assert.NotContains(t, got, "submit.php")
		})
	}
}

func TestRequestXunhuPayPostsToConfiguredGateway(t *testing.T) {
	restore := setupXunhuPayTestDB(t)
	defer restore()
	configureXunhuPay(t)

	var posted url.Values
	var postedPath string
	var contentType string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		postedPath = r.URL.RequestURI()
		contentType = r.Header.Get("Content-Type")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var fields map[string]string
		if err := common.Unmarshal(body, &fields); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		posted = url.Values{}
		for key, value := range fields {
			posted.Set(key, value)
		}
		responseFields := map[string]string{
			"errcode":    "0",
			"errmsg":     "success!",
			"url":        "https://pay.example.com/mobile",
			"url_qrcode": "https://pay.example.com/qr.png",
		}
		responseFields["hash"] = xunhuPayHash(responseFields, "wechat-secret")
		payload, err := common.Marshal(map[string]any{
			"errcode":    0,
			"errmsg":     responseFields["errmsg"],
			"url":        responseFields["url"],
			"url_qrcode": responseFields["url_qrcode"],
			"hash":       responseFields["hash"],
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	defer gateway.Close()
	operation_setting.XunhuPayGateway = gateway.URL + "/payment/do.html"

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 7)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/xunhupay/pay", strings.NewReader(`{"amount":10,"payment_method":"xunhupay_wxpay"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	RequestXunhuPay(ctx)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Equal(t, "/payment/do.html", postedPath)
	assert.NotContains(t, postedPath, "submit.php")
	assert.Contains(t, contentType, "application/json")
	require.NotNil(t, posted)
	assert.Equal(t, "wx-app", posted.Get("appid"))
	assert.Empty(t, posted.Get("type"))
	signed := map[string]string{}
	for key := range posted {
		signed[key] = posted.Get(key)
	}
	assert.Equal(t, xunhuPayHash(signed, "wechat-secret"), posted.Get("hash"))
	assert.Equal(t, "https://billing.example.com/api/user/xunhupay/notify", posted.Get("notify_url"))
	assert.Contains(t, recorder.Body.String(), "https://pay.example.com/qr.png")

	var topUp model.TopUp
	require.NoError(t, model.DB.Where("user_id = ?", 7).First(&topUp).Error)
	assert.Equal(t, model.PaymentProviderXunhuPay, topUp.PaymentProvider)
	assert.Equal(t, model.PaymentMethodXunhuPayWechat, topUp.PaymentMethod)
	assert.Equal(t, common.TopUpStatusPending, topUp.Status)
	assert.Equal(t, posted.Get("trade_order_id"), topUp.TradeNo)
	assert.InDelta(t, 10.0, topUp.Money, 0.001)
}

func TestXunhuPayNotifyCreditsOnceAndRejectsBadCallbacks(t *testing.T) {
	restore := setupXunhuPayTestDB(t)
	defer restore()
	configureXunhuPay(t)

	order := &model.TopUp{
		UserId:          7,
		Amount:          10,
		Money:           10,
		TradeNo:         "X7ORDER",
		PaymentMethod:   model.PaymentMethodXunhuPayWechat,
		PaymentProvider: model.PaymentProviderXunhuPay,
		Status:          common.TopUpStatusPending,
		CreateTime:      1,
	}
	require.NoError(t, order.Insert())

	params := map[string]string{
		"trade_order_id": "X7ORDER",
		"total_fee":      "10.00",
		"transaction_id": "tx1",
		"open_order_id":  "open1",
		"order_title":    "Topup10",
		"status":         "OD",
		"appid":          "wx-app",
		"time":           "1522390464",
		"nonce_str":      "nonce",
	}
	params["hash"] = xunhuPayHash(params, "wechat-secret")
	recorder := postXunhuPayNotify(params)
	assert.Equal(t, "success", recorder.Body.String())
	assert.Equal(t, 10*int(common.QuotaPerUnit), xunhuPayUserQuota(t, 7))
	assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo("X7ORDER").Status)

	again := postXunhuPayNotify(params)
	assert.Equal(t, "success", again.Body.String())
	assert.Equal(t, 10*int(common.QuotaPerUnit), xunhuPayUserQuota(t, 7))

	params["total_fee"] = "1.00"
	params["hash"] = xunhuPayHash(params, "wechat-secret")
	underpaid := postXunhuPayNotify(params)
	assert.Equal(t, "success", underpaid.Body.String())
	assert.Equal(t, 10*int(common.QuotaPerUnit), xunhuPayUserQuota(t, 7))
}

func TestXunhuPayNotifyRejectsMismatchAndInvalidSignature(t *testing.T) {
	restore := setupXunhuPayTestDB(t)
	defer restore()
	configureXunhuPay(t)

	pending := &model.TopUp{
		UserId:          7,
		Amount:          10,
		Money:           10,
		TradeNo:         "X7PENDING",
		PaymentMethod:   model.PaymentMethodXunhuPayWechat,
		PaymentProvider: model.PaymentProviderXunhuPay,
		Status:          common.TopUpStatusPending,
		CreateTime:      1,
	}
	require.NoError(t, pending.Insert())
	epayOrder := &model.TopUp{
		UserId:          7,
		Amount:          10,
		Money:           10,
		TradeNo:         "EPAYORDER",
		PaymentMethod:   "alipay",
		PaymentProvider: model.PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
		CreateTime:      1,
	}
	require.NoError(t, epayOrder.Insert())

	badAmount := signedXunhuNotify("X7PENDING", "9.99", "wx-app", "wechat-secret")
	assert.Equal(t, "fail", postXunhuPayNotify(badAmount).Body.String())
	assert.Equal(t, 0, xunhuPayUserQuota(t, 7))
	assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo("X7PENDING").Status)

	badSign := signedXunhuNotify("X7PENDING", "10.00", "wx-app", "wechat-secret")
	badSign["hash"] = "deadbeef"
	assert.Equal(t, "fail", postXunhuPayNotify(badSign).Body.String())

	wrongApp := signedXunhuNotify("X7PENDING", "10.00", "ali-app", "alipay-secret")
	assert.Equal(t, "fail", postXunhuPayNotify(wrongApp).Body.String())

	crossProvider := signedXunhuNotify("EPAYORDER", "10.00", "wx-app", "wechat-secret")
	assert.Equal(t, "fail", postXunhuPayNotify(crossProvider).Body.String())
	assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo("EPAYORDER").Status)
	assert.Equal(t, 0, xunhuPayUserQuota(t, 7))

	valid := signedXunhuNotify("X7PENDING", "10.00", "wx-app", "wechat-secret")
	assert.Equal(t, "success", postXunhuPayNotify(valid).Body.String())
	assert.Equal(t, 10*int(common.QuotaPerUnit), xunhuPayUserQuota(t, 7))
}

func signedXunhuNotify(tradeNo string, fee string, appID string, secret string) map[string]string {
	params := map[string]string{
		"trade_order_id": tradeNo,
		"total_fee":      fee,
		"status":         "OD",
		"appid":          appID,
		"nonce_str":      "nonce",
		"time":           "1522390464",
	}
	params["hash"] = xunhuPayHash(params, secret)
	return params
}

func postXunhuPayNotify(params map[string]string) *httptest.ResponseRecorder {
	form := url.Values{}
	for key, value := range params {
		form.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/xunhupay/notify", strings.NewReader(form.Encode()))
	ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	XunhuPayNotify(ctx)
	return recorder
}

func configureXunhuPay(t *testing.T) {
	t.Helper()
	operation_setting.XunhuPayGateway = operation_setting.DefaultXunhuPayGateway
	operation_setting.XunhuPayWechatAppId = "wx-app"
	operation_setting.XunhuPayWechatAppSecret = "wechat-secret"
	operation_setting.XunhuPayAlipayAppId = "ali-app"
	operation_setting.XunhuPayAlipayAppSecret = "alipay-secret"
	operation_setting.Price = 1
	operation_setting.MinTopUp = 1
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	common.QuotaPerUnit = 500000
	system_setting.ServerAddress = "https://billing.example.com"
	operation_setting.CustomCallbackAddress = ""
}

func setupXunhuPayTestDB(t *testing.T) func() {
	t.Helper()
	gin.SetMode(gin.TestMode)
	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldQuota := common.QuotaPerUnit
	oldPrice := operation_setting.Price
	oldMin := operation_setting.MinTopUp
	oldDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	oldGateway := operation_setting.XunhuPayGateway
	oldWechatID := operation_setting.XunhuPayWechatAppId
	oldWechatSecret := operation_setting.XunhuPayWechatAppSecret
	oldAlipayID := operation_setting.XunhuPayAlipayAppId
	oldAlipaySecret := operation_setting.XunhuPayAlipayAppSecret
	oldServer := system_setting.ServerAddress
	oldCallback := operation_setting.CustomCallbackAddress
	oldCompliance := *operation_setting.GetPaymentSetting()
	oldRedis := common.RedisEnabled
	common.RedisEnabled = false
	model.InitColumnNames()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}))
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.Create(&model.User{
		Id:       7,
		Username: "xunhu-user",
		Quota:    0,
		Status:   common.UserStatusEnabled,
	}).Error)

	return func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.QuotaPerUnit = oldQuota
		operation_setting.Price = oldPrice
		operation_setting.MinTopUp = oldMin
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplay
		operation_setting.XunhuPayGateway = oldGateway
		operation_setting.XunhuPayWechatAppId = oldWechatID
		operation_setting.XunhuPayWechatAppSecret = oldWechatSecret
		operation_setting.XunhuPayAlipayAppId = oldAlipayID
		operation_setting.XunhuPayAlipayAppSecret = oldAlipaySecret
		system_setting.ServerAddress = oldServer
		operation_setting.CustomCallbackAddress = oldCallback
		*operation_setting.GetPaymentSetting() = oldCompliance
		common.RedisEnabled = oldRedis
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	}
}

func xunhuPayUserQuota(t *testing.T, userID int) int {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.Select("quota").Where("id = ?", userID).First(&user).Error)
	return user.Quota
}

func TestXunhuPayNotifyDisabledWithoutCredentials(t *testing.T) {
	oldGateway := operation_setting.XunhuPayGateway
	oldWechatID := operation_setting.XunhuPayWechatAppId
	oldWechatSecret := operation_setting.XunhuPayWechatAppSecret
	oldAlipayID := operation_setting.XunhuPayAlipayAppId
	oldAlipaySecret := operation_setting.XunhuPayAlipayAppSecret
	t.Cleanup(func() {
		operation_setting.XunhuPayGateway = oldGateway
		operation_setting.XunhuPayWechatAppId = oldWechatID
		operation_setting.XunhuPayWechatAppSecret = oldWechatSecret
		operation_setting.XunhuPayAlipayAppId = oldAlipayID
		operation_setting.XunhuPayAlipayAppSecret = oldAlipaySecret
	})
	operation_setting.XunhuPayWechatAppId = ""
	operation_setting.XunhuPayWechatAppSecret = ""
	operation_setting.XunhuPayAlipayAppId = ""
	operation_setting.XunhuPayAlipayAppSecret = ""

	recorder := postXunhuPayNotify(map[string]string{"hash": "x", "status": "OD"})
	assert.Equal(t, "fail", recorder.Body.String())
	assert.False(t, isXunhuPayTopUpEnabled())
}
