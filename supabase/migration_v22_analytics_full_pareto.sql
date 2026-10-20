-- Apply after v21. Return every ranked entity in the chart; keep table pagination.
-- Preserve the deployed calculation, security attributes, grants and CMV policy.
BEGIN;
DO $$
DECLARE
 signature regprocedure;
 definition text;
 limited text := 'SELECT jsonb_agg(row ORDER BY rank) FROM payload WHERE rank<=60';
 complete text := 'SELECT jsonb_agg(row ORDER BY rank) FROM payload';
 occurrences integer;
BEGIN
 IF to_regprocedure('public.analytics_abc_components_v21(uuid,uuid,jsonb,jsonb,integer,integer,text,text)') IS NULL THEN
  RAISE EXCEPTION 'APPLY_ANALYTICS_V21_FIRST';
 END IF;
 FOREACH signature IN ARRAY ARRAY[
  'public.analytics_abc(uuid,uuid,jsonb,integer,integer,text,text)'::regprocedure,
  'public.analytics_abc_components(uuid,uuid,jsonb,jsonb,integer,integer,text,text)'::regprocedure
 ] LOOP
  definition := pg_get_functiondef(signature);
  occurrences := (length(definition)-length(replace(definition,limited,'')))/length(limited);
  IF occurrences=1 THEN
   EXECUTE replace(definition,limited,complete);
  ELSIF occurrences<>0 OR strpos(definition,complete||')')=0 THEN
   RAISE EXCEPTION 'UNEXPECTED_PARETO_DEFINITION: %',signature;
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema'; 
COMMIT;
