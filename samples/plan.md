# Sample Feature Plan

## Context

This plan implements a user authentication system for the web application.
The system should support email/password login and OAuth2 providers.

## Step 1: Database Schema

Create the users table with email, password hash, and OAuth fields.

### Step 1 Acceptance

- Users table created with proper indexes
- Migration runs cleanly
- Rollback migration works

## Step 2: Authentication API

Implement login, register, and token refresh endpoints.

### Step 2 Acceptance

- POST /auth/register creates a user
- POST /auth/login returns a JWT
- POST /auth/refresh returns a new JWT
- Invalid credentials return 401

## Step 3: OAuth2 Integration

Add Google and GitHub OAuth2 providers.

### Step 3 Acceptance

- Google OAuth flow works end to end
- GitHub OAuth flow works end to end
- OAuth users are linked to existing accounts by email

## Verification

Run the full test suite and verify:
- All auth endpoints respond correctly
- JWT tokens are valid and expire properly
- OAuth redirects work in staging environment

## Notes

> This plan targets v2.0 of the auth system. v1.0 used session cookies.
> Migration path from v1.0 is tracked in a separate plan.
