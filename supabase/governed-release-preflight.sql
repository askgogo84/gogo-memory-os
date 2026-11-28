-- Read-only schema collision/precondition report for governed-run-ledger-v1.sql.
-- This does NOT apply the migration, enable any feature, seed prices, or clear
-- independent security review. Run as the project owner on the exact target.
BEGIN READ ONLY;
WITH required(table_name,column_name) AS (VALUES
 ('users','id'),('users','telegram_id'),('users','access_status'),
 ('users','gmail_connected'),('users','gmail_send_connected'),('users','gmail_email'),
 ('users','gmail_refresh_token'),('users','gmail_access_token'),('users','whatsapp_id'),
 ('users','google_calendar_connected'),('users','google_refresh_token'),('users','timezone'),
 ('workspaces','id'),('workspaces','pilot_read_only'),('merchant_outlets','id'),('merchant_outlets','workspace_id'),
 ('merchant_orders','id'),('merchant_orders','outlet_id'),('merchant_orders','source'),('merchant_orders','state'),
 ('merchant_orders','cancel_reason'),('merchant_orders','created_at'),('merchant_orders','updated_at'),
 ('workspace_members','workspace_id'),('workspace_members','telegram_id'),('workspace_members','role'),
 ('user_consent_settings','telegram_id'),('user_consent_settings','memory_enabled'),
 ('agent_activity','id'),('agent_activity','telegram_id'),('agent_activity','event_type'),
 ('agent_activity','metadata_json'),('agent_activity','created_at'),
 ('agent_runs','id'),('agent_runs','telegram_id'),('agent_runs','status'),('agent_runs','metadata_json'),
 ('agent_approvals','requested_at'),('agent_approvals','execution_payload'),('memories','id'))
SELECT 'missing_prerequisite' AS kind,r.table_name AS object_name,r.column_name AS detail
FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
WHERE c.column_name IS NULL
UNION ALL
SELECT 'existing_governance_object',tablename,NULL FROM pg_tables
 WHERE schemaname='public' AND (tablename LIKE 'gogo_governed_%' OR tablename LIKE 'gogo_skill_%' OR tablename IN ('gogo_memory_block_events','gogo_workspace_incidents'))
UNION ALL
SELECT 'existing_governance_routine',p.proname,pg_get_function_identity_arguments(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('gogo_open_governed_run','gogo_reserve_governed_attempt','gogo_finish_governed_attempt',
 'gogo_settle_governed_attempt','gogo_change_skill_revision','gogo_record_memory_block_event',
 'gogo_read_scope_budget','gogo_prune_memory_block_events','gogo_propose_skill_learning',
 'gogo_prune_skill_learning_candidates','gogo_materialize_recovery_revision','gogo_workspace_incident_action')
UNION ALL
SELECT 'id_type',c.table_name,c.data_type FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.column_name='id' AND c.table_name IN ('agent_activity','agent_runs','users')
UNION ALL
SELECT 'existing_provenance_column',c.table_name,c.data_type FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='memories' AND c.column_name='gogo_provenance'
ORDER BY 1,2,3;
COMMIT;
