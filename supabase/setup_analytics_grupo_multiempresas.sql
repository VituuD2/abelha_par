-- Optional setup for the specific group identified by the responsible user.
-- Apply AFTER v11, BEFORE importing any analytical sales. No OAuth secrets here.
-- Replace REPLACE_WITH_AUTHORIZED_WORKSPACE_UUID with the intended workspace UUID.
-- This is deliberately separate from the generic migration: other workspaces are not seeded.
BEGIN;
DO $$ DECLARE
 target_workspace uuid := 'REPLACE_WITH_AUTHORIZED_WORKSPACE_UUID'::uuid;
 primary_connection analytics_connections;
 company analytics_companies;
 entry record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=target_workspace AND active AND role='admin') THEN RAISE EXCEPTION 'AUTHORIZED_WORKSPACE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM analytics_orders WHERE workspace_id=target_workspace) THEN RAISE EXCEPTION 'USE_NINHO_FOR_ALREADY_IMPORTED_WORKSPACE'; END IF;
 SELECT * INTO primary_connection FROM analytics_connections WHERE workspace_id=target_workspace AND credential_kind='legacy' AND legacy_integration_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXISTING_OLIST_2_CONNECTION_REQUIRED'; END IF;
 IF primary_connection.verified_tax_id IS NOT NULL AND primary_connection.verified_tax_id<>'36965322000112' THEN RAISE EXCEPTION 'EXISTING_COMPANY_MISMATCH'; END IF;
 UPDATE analytics_companies SET name='Olist 2',tax_id='36965322000112' WHERE workspace_id=target_workspace AND id=primary_connection.company_id;
 UPDATE analytics_connections SET name='Olist 2' WHERE workspace_id=target_workspace AND id=primary_connection.id;
 FOR entry IN SELECT * FROM (VALUES('Olist 1','13397731000164'),('Olist 3','37201039000187')) AS group_companies(name,tax_id) LOOP
  INSERT INTO analytics_companies(workspace_id,name,tax_id) VALUES(target_workspace,entry.name,entry.tax_id)
  ON CONFLICT(workspace_id,tax_id) DO UPDATE SET name=excluded.name RETURNING * INTO company;
  IF NOT EXISTS(SELECT 1 FROM analytics_connections WHERE workspace_id=target_workspace AND company_id=company.id) THEN
   INSERT INTO analytics_connections(workspace_id,company_id,name,enabled) VALUES(target_workspace,company.id,entry.name,false);
  END IF;
 END LOOP;
 -- Pending connections have no token, secret or fake validation. Configure and authorize them in Ninho.
END $$;
COMMIT;
