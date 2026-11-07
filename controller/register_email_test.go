/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRegisterKeepsEmailWhenVerificationIsDisabled(t *testing.T) {
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	previousRegister := common.RegisterEnabled
	previousPasswordRegister := common.PasswordRegisterEnabled
	previousVerification := common.EmailVerificationEnabled
	previousDomain := common.EmailDomainRestrictionEnabled
	previousAlias := common.EmailAliasRestrictionEnabled
	previousQuota := common.QuotaForNewUser
	previousDefaultToken := constant.GenerateDefaultToken
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.RedisEnabled = false
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	common.EmailDomainRestrictionEnabled = false
	common.EmailAliasRestrictionEnabled = false
	common.QuotaForNewUser = 0
	constant.GenerateDefaultToken = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		common.RegisterEnabled = previousRegister
		common.PasswordRegisterEnabled = previousPasswordRegister
		common.EmailVerificationEnabled = previousVerification
		common.EmailDomainRestrictionEnabled = previousDomain
		common.EmailAliasRestrictionEnabled = previousAlias
		common.QuotaForNewUser = previousQuota
		constant.GenerateDefaultToken = previousDefaultToken
	})
	gin.SetMode(gin.TestMode)

	t.Run("stores a normalized email without a verification code", func(t *testing.T) {
		common.EmailVerificationEnabled = false
		response := postRegister(t, `{"username":"lingyu-user","password":"register-pass-1","email":" User@Example.com ","verification_code":"000000"}`)
		assert.True(t, response.Success, response.Message)
		stored := requireUserByUsername(t, "lingyu-user")
		assert.Equal(t, "user@example.com", stored.Email)
	})

	t.Run("rejects an invalid email and does not create a user", func(t *testing.T) {
		common.EmailVerificationEnabled = false
		response := postRegister(t, `{"username":"bad-email-user","password":"register-pass-1","email":"not-an-email"}`)
		assert.False(t, response.Success)
		assert.Equal(t, "Please enter a valid email address", response.Message)
		assert.Equal(t, "EMAIL_ADDRESS_REJECTED", response.Code)
		assertMissingUser(t, "bad-email-user")
	})

	t.Run("rejects a duplicate email", func(t *testing.T) {
		common.EmailVerificationEnabled = false
		response := postRegister(t, `{"username":"second-user","password":"register-pass-1","email":"user@example.com"}`)
		assert.False(t, response.Success)
		assert.Equal(t, "Email address is already in use", response.Message)
		assertMissingUser(t, "second-user")
	})

	t.Run("still requires a matching code when verification is enabled", func(t *testing.T) {
		common.EmailVerificationEnabled = true
		response := postRegister(t, `{"username":"coded-user","password":"register-pass-1","email":"coded@example.com","verification_code":"000000"}`)
		assert.False(t, response.Success)
		assert.Equal(t, "Verification code is incorrect or has expired", response.Message)
		assertMissingUser(t, "coded-user")

		common.RegisterVerificationCodeWithKey("coded@example.com", "654321", common.EmailVerificationPurpose)
		t.Cleanup(func() {
			common.DeleteKey("coded@example.com", common.EmailVerificationPurpose)
		})
		response = postRegister(t, `{"username":"coded-user","password":"register-pass-1","email":"coded@example.com","verification_code":"654321"}`)
		assert.True(t, response.Success, response.Message)
		stored := requireUserByUsername(t, "coded-user")
		assert.Equal(t, "coded@example.com", stored.Email)
	})
}

type registerResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Code    string `json:"code"`
}

func postRegister(t *testing.T, body string) registerResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")
	Register(context)
	var response registerResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func requireUserByUsername(t *testing.T, username string) model.User {
	t.Helper()
	var stored model.User
	require.NoError(t, model.DB.Where("username = ?", username).First(&stored).Error)
	return stored
}

func assertMissingUser(t *testing.T, username string) {
	t.Helper()
	var count int64
	require.NoError(t, model.DB.Model(&model.User{}).Where("username = ?", username).Count(&count).Error)
	assert.Equal(t, int64(0), count)
}
