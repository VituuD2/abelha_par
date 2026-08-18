-- Stores the person responsible for completing each scan batch.
-- Existing batches are retained and marked as not informed.
ALTER TABLE public.lotes_bipagem
  ADD COLUMN IF NOT EXISTS responsavel text NOT NULL DEFAULT 'Não informado';

ALTER TABLE public.lotes_bipagem
  DROP CONSTRAINT IF EXISTS lotes_bipagem_responsavel_valid;

ALTER TABLE public.lotes_bipagem
  ADD CONSTRAINT lotes_bipagem_responsavel_valid
  CHECK (char_length(trim(responsavel)) BETWEEN 3 AND 100);

ALTER TABLE public.lotes_bipagem
  ALTER COLUMN responsavel DROP DEFAULT;
