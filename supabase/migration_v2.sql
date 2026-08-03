-- Migration V2: Add refresh_expires_at to tiny_integrations
-- Run this SQL in the Supabase SQL Editor

ALTER TABLE tiny_integrations 
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN tiny_integrations.refresh_expires_at IS 'When the refresh token itself expires. After this, user must re-authenticate.';
