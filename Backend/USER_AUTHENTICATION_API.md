# 🔐 User Authentication API Documentation

This document covers all user authentication endpoints for the Raw Materials Marketplace backend system.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Authentication Flow](#authentication-flow)
3. [Email Verification Endpoints](#email-verification-endpoints)
4. [User Registration](#user-registration)
5. [Login Methods](#login-methods)
6. [Profile Management](#profile-management)
7. [Token Management](#token-management)
8. [Error Handling](#error-handling)
9. [Testing Guide](#testing-guide)

---

## 🎯 Overview

The authentication system provides secure user registration and login functionality with email verification using OTP (One-Time Password). It supports both password-based and OTP-based authentication methods.

**Base URL:** `http://localhost:5000/api/users`

### Key Features

- ✅ Email verification with OTP
- ✅ Secure password-based login
- ✅ OTP-based signin (passwordless)
- ✅ JWT token authentication
- ✅ Rate limiting for OTP requests
- ✅ Comprehensive profile management

---

## 🔄 Authentication Flow

### Registration Flow

```
1. Send Email Verification OTP → 2. Verify Email OTP → 3. Complete Registration → 4. Login
```

### Login Flow Options

```
Option A: Email + Password → Access Token
Option B: Request Signin OTP → Verify Signin OTP → Access Token
```

---

## 📧 Email Verification Endpoints

### 1. Send Email Verification OTP

**Endpoint:** `POST http://localhost:5000/api/users/send-verification-otp`

**Description:** Sends a 6-digit OTP to the user's email for verification during signup.

**Request Body:**

```json
{
  "email": "john@example.com",
  "username": "johndoe"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/send-verification-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "username": "johndoe"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "OTP sent successfully to your email",
  "data": {
    "email": "john@example.com"
  }
}
```

**Features:**

- ✅ Rate limiting (30 seconds between requests)
- ✅ Username conflict checking
- ✅ Professional HTML email template
- ✅ 5-minute OTP expiry

---

### 2. Verify Email OTP

**Endpoint:** `POST /api/users/verify-email-otp`

**Description:** Verifies the OTP sent to user's email and marks email as verified.

**Request Body:**

```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/verify-email-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Email verified successfully. Please complete your registration.",
  "data": {
    "email": "john@example.com",
    "isEmailVerified": true
  }
}
```

---

### 3. Resend Email Verification OTP

**Endpoint:** `POST /api/users/resend-verification-otp`

**Description:** Resends verification OTP if the previous one expired or was lost.

**Request Body:**

```json
{
  "email": "john@example.com",
  "username": "johndoe"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/resend-verification-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "username": "johndoe"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "New OTP sent successfully",
  "data": {
    "email": "john@example.com"
  }
}
```

---

## 👤 User Registration

### 4. Complete User Registration

**Endpoint:** `POST /api/users/register`

**Description:** Completes user registration after email verification with all required user details.

**Request Body:**

```json
{
  "name": "John Doe",
  "username": "johndoe",
  "email": "john@example.com",
  "password": "password123",
  "fullname": "John Doe Smith",
  "phone": "1234567890",
  "address": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "pincode": "10001",
    "geolocation": {
      "lat": 40.7128,
      "lng": -74.006
    }
  }
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "password": "password123",
    "fullname": "John Doe Smith",
    "phone": "1234567890",
    "address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "pincode": "10001",
      "geolocation": {
        "lat": 40.7128,
        "lng": -74.0060
      }
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "name": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "fullname": "John Doe Smith",
    "phone": "1234567890",
    "isEmailVerified": true,
    "avatar": "https://ui-avatars.com/api/?name=John%20Doe%20Smith&background=6366f1&color=ffffff&size=200",
    "address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "pincode": "10001",
      "geolocation": {
        "lat": 40.7128,
        "lng": -74.006
      }
    },
    "createdAt": "2025-07-26T10:30:00.000Z"
  }
}
```

**Validation Requirements:**

- ✅ Email must be pre-verified
- ✅ Username must be unique
- ✅ Phone number must be unique
- ✅ Complete address required
- ✅ Password minimum requirements
- ✅ Geolocation coordinates (optional, defaults to 0.0)

---

## 🔑 Login Methods

### 5. Password-Based Login

**Endpoint:** `POST /api/users/login`

**Description:** Traditional login using email and password.

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "name": "John Doe",
      "username": "johndoe",
      "email": "john@example.com",
      "isEmailVerified": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 6. Send Signin OTP (Passwordless)

**Endpoint:** `POST /api/users/send-signin-otp`

**Description:** Sends OTP for passwordless login to verified users.

**Request Body:**

```json
{
  "email": "john@example.com"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/send-signin-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Signin OTP sent successfully",
  "data": {
    "email": "john@example.com"
  }
}
```

---

### 7. Verify Signin OTP

**Endpoint:** `POST /api/users/verify-signin-otp`

**Description:** Verifies signin OTP and provides access tokens.

**Request Body:**

```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/verify-signin-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "Signin successful",
  "data": {
    "user": {
      "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "name": "John Doe",
      "username": "johndoe",
      "email": "john@example.com"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 8. Resend Signin OTP

**Endpoint:** `POST /api/users/resend-signin-otp`

**Description:** Resends signin OTP if needed.

**Request Body:**

```json
{
  "email": "john@example.com"
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/resend-signin-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com"
  }'
```

**Response:**

```json
{
  "success": true,
  "message": "New signin OTP sent successfully",
  "data": {
    "email": "john@example.com"
  }
}
```

---

## 👤 Profile Management

### 9. Get Current User

**Endpoint:** `GET /api/users/get-user`

**Description:** Retrieves current authenticated user's profile information.

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**cURL Command:**

```bash
curl -X GET http://localhost:5000/api/users/get-user \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "message": "User fetched successfully",
  "data": {
    "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "name": "John Doe",
    "username": "johndoe",
    "email": "john@example.com",
    "fullname": "John Doe Smith",
    "phone": "1234567890",
    "isEmailVerified": true,
    "avatar": "https://ui-avatars.com/api/?name=John%20Doe%20Smith&background=6366f1&color=ffffff&size=200",
    "address": {
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "pincode": "10001"
    },
    "createdAt": "2025-07-26T10:30:00.000Z"
  }
}
```

---

### 10. Update Account Details

**Endpoint:** `PATCH /api/users/update-account`

**Description:** Updates user's basic account information.

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**Request Body:**

```json
{
  "name": "John Updated",
  "fullname": "John Updated Smith",
  "phone": "9876543210"
}
```

**cURL Command:**

```bash
curl -X PATCH http://localhost:5000/api/users/update-account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "name": "John Updated",
    "fullname": "John Updated Smith",
    "phone": "9876543210"
  }'
```

---

### 11. Change Password

**Endpoint:** `PATCH /api/users/change-password`

**Description:** Changes user's password (requires current password).

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**Request Body:**

```json
{
  "oldPassword": "password123",
  "newPassword": "newpassword123"
}
```

**cURL Command:**

```bash
curl -X PATCH http://localhost:5000/api/users/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "oldPassword": "password123",
    "newPassword": "newpassword123"
  }'
```

---

### 12. Change Avatar

**Endpoint:** `PATCH /api/users/change-avatar`

**Description:** Uploads and updates user's profile picture.

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**Request:** Multipart form data with file

**cURL Command:**

```bash
curl -X PATCH http://localhost:5000/api/users/change-avatar \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "avatar=@/path/to/avatar.jpg"
```

---

### 13. Change Cover Images

**Endpoint:** `PATCH /api/users/change-cover-images`

**Description:** Uploads and updates user's cover images (up to 5).

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**Request:** Multipart form data with multiple files

**cURL Command:**

```bash
curl -X PATCH http://localhost:5000/api/users/change-cover-images \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "cover images=@/path/to/cover1.jpg" \
  -F "cover images=@/path/to/cover2.jpg"
```

---

## 🎫 Token Management

### 14. Refresh Access Token

**Endpoint:** `POST /api/users/refresh-token`

**Description:** Generates new access token using refresh token.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/refresh-token \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

---

### 15. Logout User

**Endpoint:** `POST /api/users/logout`

**Description:** Logs out user and invalidates tokens.

**Headers:** `Authorization: Bearer YOUR_ACCESS_TOKEN`

**cURL Command:**

```bash
curl -X POST http://localhost:5000/api/users/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "message": "User logged out successfully"
}
```

---

## ⚠️ Error Handling

### Common Error Responses

#### 400 - Bad Request

```json
{
  "success": false,
  "message": "Email and OTP are required",
  "errors": []
}
```

#### 401 - Unauthorized

```json
{
  "success": false,
  "message": "Invalid access token",
  "errors": []
}
```

#### 404 - Not Found

```json
{
  "success": false,
  "message": "User not found",
  "errors": []
}
```

#### 409 - Conflict

```json
{
  "success": false,
  "message": "Username is already taken by another user",
  "errors": []
}
```

#### 429 - Rate Limited

```json
{
  "success": false,
  "message": "Please wait 30 seconds before requesting a new OTP",
  "errors": []
}
```

#### 500 - Server Error

```json
{
  "success": false,
  "message": "Failed to send verification email: [error details]",
  "errors": []
}
```

---

## 🧪 Testing Guide

### Step-by-Step Testing Workflow

#### 1. Complete Registration Flow

```bash
# Step 1: Send verification OTP
curl -X POST http://localhost:5000/api/users/send-verification-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "username": "testuser"}'

# Step 2: Check email and verify OTP
curl -X POST http://localhost:5000/api/users/verify-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456"}'

# Step 3: Complete registration
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123",
    "fullname": "Test User Full",
    "phone": "1234567890",
    "address": {
      "street": "123 Test St",
      "city": "Test City",
      "state": "TS",
      "pincode": "12345"
    }
  }'
```

#### 2. Login Testing

```bash
# Password-based login
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'

# OTP-based login
curl -X POST http://localhost:5000/api/users/send-signin-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

curl -X POST http://localhost:5000/api/users/verify-signin-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "otp": "123456"}'
```

#### 3. Profile Management Testing

```bash
# Get current user (save the access token from login)
curl -X GET http://localhost:5000/api/users/get-user \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Update account details
curl -X PATCH http://localhost:5000/api/users/update-account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"name": "Updated Name", "phone": "9876543210"}'
```

### Environment Setup

#### Required Environment Variables (.env)

```bash
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-gmail-app-password
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-jwt-refresh-secret-key
MONGODB_URI=mongodb://localhost:27017/your-database
```

#### Gmail App Password Setup

1. Enable 2-Factor Authentication in Gmail
2. Go to Google Account Settings → Security → App Passwords
3. Generate app password for "Mail"
4. Use generated password in `EMAIL_PASS`

---

## 🔒 Security Features

### Email Security

- ✅ Professional HTML email templates
- ✅ OTP expiry (5 minutes)
- ✅ Rate limiting (30 seconds between requests)
- ✅ Security warnings in emails

### Password Security

- ✅ Bcrypt hashing with salt rounds
- ✅ Password complexity requirements
- ✅ Secure password change process

### Token Security

- ✅ JWT with expiration
- ✅ Refresh token rotation
- ✅ HTTP-only secure cookies
- ✅ Token invalidation on logout

### Data Validation

- ✅ Input sanitization
- ✅ Email format validation
- ✅ Phone number uniqueness
- ✅ Username uniqueness
- ✅ Required field validation

---

## 📝 Notes

- All OTPs expire after 5 minutes
- Rate limiting prevents spam (30-second cooldown)
- Passwords are hashed using bcrypt
- JWT tokens are used for authentication
- Email verification is mandatory for registration
- Username and phone must be unique across the system
- Temporary users are created during email verification
- Full registration requires email verification first

---

## 🆘 Support

For issues or questions regarding the authentication system:

1. Check the error response for specific details
2. Verify environment variables are set correctly
3. Ensure email service is configured properly
4. Check database connectivity
5. Verify JWT secrets are configured

---

**Last Updated:** July 26, 2025
**API Version:** 1.0.0
**Documentation Version:** 1.0.0
