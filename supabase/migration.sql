-- Scanner Checkout — Supabase Schema
-- Run this SQL in the Supabase SQL Editor to create the required tables.

-- Batch table for storing completed scan sessions
CREATE TABLE IF NOT EXISTS lotes_bipagem (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_lote SERIAL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  qtd_pedidos INTEGER NOT NULL,
  pedidos JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE lotes_bipagem ENABLE ROW LEVEL SECURITY;

-- Allow all operations for v1 (no auth)
CREATE POLICY "Allow all operations" ON lotes_bipagem
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for faster date-based queries
CREATE INDEX IF NOT EXISTS idx_lotes_bipagem_data ON lotes_bipagem (data DESC);
CREATE INDEX IF NOT EXISTS idx_lotes_bipagem_created_at ON lotes_bipagem (created_at DESC);

-- Comment
COMMENT ON TABLE lotes_bipagem IS 'Stores completed barcode scanning sessions (batches)';
COMMENT ON COLUMN lotes_bipagem.pedidos IS 'JSON array of scanned orders: [{olistId, yampiId, trackingCode, clientName, scannedAt}]';

-- Tiny ERP integrations table for storing OAuth tokens
CREATE TABLE IF NOT EXISTS tiny_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for tiny_integrations
ALTER TABLE tiny_integrations ENABLE ROW LEVEL SECURITY;

-- Allow all operations for v1 (no auth)
CREATE POLICY "Allow all operations on tiny_integrations" ON tiny_integrations
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE tiny_integrations IS 'Stores OAuth tokens for Tiny ERP connection (single tenant for now)';
